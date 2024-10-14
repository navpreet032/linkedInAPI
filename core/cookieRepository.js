const fs = require("fs").promises;
const path = require("path");
const { CookieJar } = require("tough-cookie");
const COOKIE_PATH = "/Users/admin/Desktop/HQ-POC/HQ-linkedInAPI.v2/cookies";

class LinkedinSessionExpired extends Error {
  constructor(message) {
    super(message);
    this.name = "LinkedinSessionExpired";
  }
}

class CookieRepository {
  constructor(cookiesDir) {
    this.cookiesDir = COOKIE_PATH;
    console.log("this.cookiesDir", this.cookiesDir);
  }

  async save(cookies, username) {
    await this._ensureCookiesDir();
    const cookiejarFilepath = this._getCookiesFilepath(username);
    const serializedCookies = cookies.serializeSync();
    await fs.writeFile(cookiejarFilepath, JSON.stringify(serializedCookies));
  }

  async get(username) {
    const cookies = await this._loadCookiesFromCache(username);
    if (cookies && !CookieRepository._isTokenStillValid(cookies)) {
      throw new LinkedinSessionExpired("LinkedIn session has expired");
    }
    return cookies;
  }

  async _ensureCookiesDir() {
    try {
      await fs.mkdir(this.cookiesDir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  _getCookiesFilepath(username) {
    return path.join(this.cookiesDir, `${username}.json`);
  }

  async _loadCookiesFromCache(username) {
    const cookiejarFilepath = this._getCookiesFilepath(username);
    try {
      const data = await fs.readFile(cookiejarFilepath, "utf8");
      const serializedCookies = JSON.parse(data);
      const cookieJar = CookieJar.deserializeSync(serializedCookies);
      return cookieJar;
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  static _isTokenStillValid(cookieJar) {
    const now = Date.now();
    const cookies = cookieJar.getCookiesSync("https://www.linkedin.com");
    for (const cookie of cookies) {
      if (cookie.key === "JSESSIONID" && cookie.value) {
        // if (cookie.expires && cookie.expires.getTime() > now) {
        console.log("Session still valid");
        return true;
        // }
        break;
      }
    }

    console.log("Session expired");
    return false;
  }
}

module.exports = { CookieRepository, LinkedinSessionExpired };
