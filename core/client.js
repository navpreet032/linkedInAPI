const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const puppeteer = require("puppeteer-extra");
const { CookieRepository } = require("../core/cookieRepository");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(require("puppeteer-extra-plugin-session").default());
puppeteer.use(StealthPlugin());

class ChallengeException extends Error {
  constructor(message) {
    super(message);
    this.name = "ChallengeException";
  }
}

class UnauthorizedException extends Error {
  constructor(message) {
    super(message);
    this.name = "UnauthorizedException";
  }
}

class Client {
  constructor({
    refreshCookies = false,
    debug = false,
    proxies = {},
    cookiesDir = "",
  } = {}) {
    this.LINKEDIN_BASE_URL = "https://www.linkedin.com";
    this.API_BASE_URL = `${this.LINKEDIN_BASE_URL}/voyager/api`;
    this.REQUEST_HEADERS = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "accept-language": "en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
      "x-li-lang": "en_US",
      "x-restli-protocol-version": "2.0.0",
    };
    this.AUTH_REQUEST_HEADERS = {
      "X-Li-User-Agent":
        "LIAuthLibrary:0.0.3 com.linkedin.android:4.1.881 Asus_ASUS_Z01QD:android_9",
      "User-Agent": "ANDROID OS",
      "X-User-Language": "en",
      "X-User-Locale": "en_US",
      "Accept-Language": "en-us",
    };

    this.session = axios.create({
      baseURL: this.API_BASE_URL,
      headers: this.REQUEST_HEADERS,
      // proxy: proxies,
    });

    this.useCookieCache = !refreshCookies;
    this.cookieRepository = new CookieRepository(cookiesDir);
    this.cookieJar = new CookieJar();

    this.logger = debug ? console : { debug: () => {} };
  }

  async authenticate(username, password) {
    if (this.useCookieCache) {
      this.logger.debug("Attempting to use cached cookies");
      try {
        const cookieJar = await this.cookieRepository.get(username);
        if (cookieJar) {
          this.logger.debug("Using cached cookies");
          this.setSessionCookies(cookieJar);
          await this.fetchMetadata();
          return;
        }
      } catch (error) {
        this.logger.debug("Error retrieving cached cookies:", error);
      }
    }

    await this.doAuthenticationRequest(username, password);
    await this.fetchMetadata();
  }

  setSessionCookies(cookieJar) {
    if (!(cookieJar instanceof CookieJar)) {
      throw new Error("Expected CookieJar instance");
    }
    this.cookieJar = cookieJar;
    const cookies = this.cookieJar.getCookiesSync(this.LINKEDIN_BASE_URL);
    const jsessionid = cookies.find((cookie) => cookie.key === "JSESSIONID");
    if (jsessionid) {
      this.session.defaults.headers["csrf-token"] = jsessionid.value.replace(
        /"/g,
        ""
      );
    }
    this.session.defaults.headers.Cookie = cookies
      .map((cookie) => `${cookie.key}=${cookie.value}`)
      .join("; ");

    console.log("cookies", this.session.defaults.headers.Cookie);
  }

  async requestSessionCookies() {
    this.logger.debug("Requesting new cookies.");
    try {
      const response = await axios.get(
        `${this.LINKEDIN_BASE_URL}/uas/authenticate`,
        {
          headers: this.AUTH_REQUEST_HEADERS,
        }
      );
      return response.headers["set-cookie"];
    } catch (error) {
      this.logger.debug("Error requesting session cookies:", error);
      throw new Error("Failed to request session cookies");
    }
  }

  async doAuthenticationRequest(username, password) {
    try {
      const sessionCookies = await this.requestSessionCookies();
      const cookieJar = new CookieJar();
      sessionCookies.forEach((cookie) =>
        cookieJar.setCookieSync(cookie, this.LINKEDIN_BASE_URL)
      );
      this.setSessionCookies(cookieJar);

      const payload = {
        session_key: username,
        session_password: password,
        JSESSIONID: cookieJar
          .getCookiesSync(this.LINKEDIN_BASE_URL)
          .find((cookie) => cookie.key === "JSESSIONID").value,
      };
      let response;
      try {
        response = await axios.post(
          `${this.LINKEDIN_BASE_URL}/uas/authenticate`,
          new URLSearchParams(payload).toString(),
          {
            headers: {
              ...this.AUTH_REQUEST_HEADERS,
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: this.session.defaults.headers.Cookie,
            },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 303,
          }
        );
      } catch (error) {
        console.log("error", error.response.data);
        const data = error.response.data;
        this.logger.debug("Challenge detected, solving with puppeteer...");
        await this.solveChallengeWithPuppeteer(
          data.challenge_url,
          "preetpannu032@gmail"
        );
        return; // Stop further execution, let puppeteer handle
      }

      const data = response.data;

      if (data && data.login_result !== "PASS") {
        throw new Error(data.login_result);
      }

      if (response.status === 401) {
        console.log("Unauthorized1");
        // throw new Error("Unauthorized");
      }

      if (response.status !== 200) {
        throw new Error("Authentication failed");
      }

      const newCookieJar = new CookieJar();
      response.headers["set-cookie"].forEach((cookie) =>
        newCookieJar.setCookieSync(cookie, this.LINKEDIN_BASE_URL)
      );
      this.setSessionCookies(newCookieJar);
      await this.cookieRepository.save(newCookieJar, username);
    } catch (error) {
      this.logger.debug("Authentication error:", error.message);
      throw error;
    }
  }

  async fetchMetadata() {
    const response = await axios.get(this.LINKEDIN_BASE_URL, {
      headers: this.AUTH_REQUEST_HEADERS,
      jar: this.cookieJar,
      withCredentials: true,
    });

    const $ = cheerio.load(response.data);

    const clientApplicationInstanceRaw = $(
      'meta[name="applicationInstance"]'
    ).attr("content");
    if (clientApplicationInstanceRaw) {
      this.metadata.clientApplicationInstance = JSON.parse(
        clientApplicationInstanceRaw
      );
    }

    const clientPageInstanceId = $('meta[name="clientPageInstanceId"]').attr(
      "content"
    );
    if (clientPageInstanceId) {
      this.metadata.clientPageInstanceId = clientPageInstanceId;
    }
  }

  async solveChallengeWithPuppeteer(challengeUrl, username) {
    try {
      // Launch Puppeteer with session saving plugin
      const browser = await puppeteer.launch({
        headless: false, // Turn this off to see what's happening
      });

      const page = await browser.newPage();

      // Set cookies before navigating to the challenge page
      const cookies = this.cookieJar.getCookiesSync(this.LINKEDIN_BASE_URL);
      const formattedCookies = cookies.map((cookie) => ({
        name: cookie.key,
        value: cookie.value,
        domain: ".linkedin.com",
        path: "/",
      }));
      await page.setCookie(...formattedCookies);

      await page.goto(challengeUrl, { waitUntil: "networkidle2" });

      // Manually solve the challenge or automate if possible
      // ...

      // Save session cookies after solving the challenge
      const sessionCookies = await page.cookies();
      const cookieJar = new CookieJar();
      sessionCookies.forEach((cookie) =>
        cookieJar.setCookieSync(
          `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}`,
          this.LINKEDIN_BASE_URL
        )
      );
      this.setSessionCookies(cookieJar);
      await this.cookieRepository.save(cookieJar, username);

      // await browser.close();
    } catch (error) {
      this.logger.error("Puppeteer challenge solving failed:", error);
      throw error;
    }
  }
}

module.exports = Client;
