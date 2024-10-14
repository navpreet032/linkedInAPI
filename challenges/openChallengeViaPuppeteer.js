require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { StorageProviderName } = require("puppeteer-extra-plugin-session");

const readline = require("readline");
const { Sentry } = require("./services/sentry");
const path = require("path");
const fs = require("fs");
const userModel = require("./schema/User");

const { delay, takeScreenshot } = require("./utils");
const logtail = require("./services/logtail");
puppeteer.use(require("puppeteer-extra-plugin-session").default());
puppeteer.use(StealthPlugin());
class LinkedInBrowserLoginScraper {
  constructor(
    // sessionCookieValue,
    email,
    password,
    bCookie,
    bsCookie,
    userId,
    browser
  ) {
    this.headless = false;
    this.browser = browser || null;
    this.email = email;
    this.password = password;
    // this.sessionCookieValue = sessionCookieValue;
    this.bCookie = bCookie || null;
    this.bsCookie = bsCookie || null;
    this.userId = userId || null;
  }

  async getUserDataDir(userId) {
    return path.resolve(__dirname, "user_sessions", userId);
  }

  async updateDB(linkedinAuthStatus) {
    await userModel.updateOne(
      {
        _id: this.userId,
      },
      {
        linkedinAuthStatus: linkedinAuthStatus,
      }
    );
  }

  async verifyCaptcha(page, captchaToken) {
    try {
      console.log("in verify captcha funstion");
      await page.evaluate((token) => {
        document.querySelector('input[name="captchaUserResponseToken"]').value =
          token;
        document.querySelector("form").submit();
      }, captchaToken);

      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
    } catch (error) {
      console.log("Error during captcha submission:", error.message);
    }
  }

  async findstatus() {
    const user = await userModel.findOne({
      _id: this.userId,
    });

    return user?.linkedinAuthStatus;
  }

  async checkForNetErrorPage(page) {
    try {
      const netError = await page.$("#main-message h1");
      let netErrorText = "";
      let netErrorSelector = await page.$(".neterror");
      if (netError) {
        netErrorText = await page.evaluate(() => {
          const element = document.querySelector("#main-message h1");
          return element ? element.textContent.trim() : "";
        });
      }

      if (netErrorText == "This site can't be reached" || netErrorSelector) {
        return true;
      } else return false;
    } catch (error) {
      console.log("failed to find the type of unknow page", error.message);
      return false;
    }
  }

  async navigateToProfile(page, maxRetries = 4, retryDelay = 4000) {
    let attempts = 0;
    // const keyToDelete = "voyager-web:msg-overlay-state";
    while (attempts < maxRetries) {
      try {
        // await page.evaluateOnNewDocument((key) => {
        //   localStorage.removeItem(key);
        // }, keyToDelete);
        // await page.waitForTimeout(1500);
        await page.goto("https://www.linkedin.com/", {
          waitUntil: "domcontentloaded",
        });
        await page.waitForTimeout(6000);
        return;
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed: ${error.message}`);
        if (attempts < maxRetries) {
          console.log(`Retrying in ${retryDelay} ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          await this.updateDB("FAILED");
          console.log("no navigation so closing all pages and retrying again");
          //   await page.close(); //close it or not?
          throw new Error("Failed to navigate to linkedin url");
        }
      }
    }
  }

  /**
   * Setup puppeteer
   */
  async setup() {
    try {
      const defaultArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--proxy-server='direct://",
        "--proxy-bypass-list=*",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-features=site-per-process",
        "--enable-features=NetworkService",
        "--allow-running-insecure-content",
        "--enable-automation",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-web-security",
        "--autoplay-policy=user-gesture-required",
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-client-side-phishing-detection",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-extensions",
        "--disable-features=AudioServiceOutOfProcess",
        "--disable-hang-monitor",
        "--disable-ipc-flooding-protection",
        "--disable-notifications",
        "--disable-offer-store-unmasked-wallet-cards",
        "--disable-popup-blocking",
        "--disable-print-preview",
        "--disable-prompt-on-repost",
        "--disable-speech-api",
        "--disable-sync",
        "--disk-cache-size=33554432",
        "--hide-scrollbars",
        "--ignore-gpu-blacklist",
        "--metrics-recording-only",
        "--mute-audio",
        "--no-default-browser-check",
        "--no-first-run",
        "--no-pings",
        "--no-zygote",
        "--password-store=basic",
        "--use-gl=swiftshader",
        "--use-mock-keychain",
        "--disable-blink-features=AutomationControlled",
      ];
      const args = defaultArgs;
      if (this.headless) {
        args.push("--single-process");
      } else {
        args.push("--start-maximized");
      }

      this.browser = await puppeteer.launch({
        headless: this.headless,
        defaultViewport: null,
        args,
        userDataDir: `./user_sessions/${this.userId}`,
      });
    } catch (err) {
      Sentry.captureException(err);
      await this.updateDB("FAILED");
      if (this.browser) {
        await this.close();
      }
      console.log(err);
    }
  }

  async closeAllPages() {
    if (this.browser) {
      const pages = await this.browser.pages();

      const closePage = async (page) => {
        try {
          await page.close();
        } catch (error) {
          console.log("Error closing page:", error);
        }
      };

      const timeout = new Promise((resolve) => {
        setTimeout(() => {
          resolve("timeout");
        }, 20000); // 20 seconds timeout
      });

      await Promise.race([
        Promise.all(pages.map((page) => closePage(page))),
        timeout,
      ]);
    }
  }

  /**
   * Kill Operation
   */
  async close() {
    if (this.browser) {
      const combinedTimeout = new Promise((resolve) => {
        setTimeout(() => {
          resolve("timeout");
        }, 30000); // 30 seconds combined timeout
      });

      const closeOperations = async () => {
        try {
          await this.closeAllPages();
        } catch (error) {
          console.log("Error closing all pages:", error);
        }

        try {
          await this.browser.close();
          return "closed";
        } catch (error) {
          console.log("Error closing browser:", error);
          return "error_closing";
        }
      };

      const result = await Promise.race([closeOperations(), combinedTimeout]);

      if (result === "timeout") {
        console.log("Closing process timed out. Browser may still be open.");
        return "timeout";
      } else if (result === "closed") {
        console.log("Browser closed successfully.");
        return "closed";
      } else if (result === "error_closing") {
        console.log("Browser closure encountered an error.");
        return "error_closing";
      }
    }
  }

  async putLoginCredentials(page) {
    const userNameEle = await page.$("#username");
    if (userNameEle) {
      const emailValue = await page.evaluate(
        () => document.querySelector("#username").value
      );

      if (!emailValue) {
        await page.type("#username", this.email, {
          delay: 50,
        });
      } else {
        // Focus on the input field and select all content using Ctrl + A, then delete it
        await page.click("#username"); // Focus on the input field
        await page.keyboard.down("Control");
        await page.keyboard.press("A"); // Select all
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace"); // Clear the field

        await page.waitForTimeout(500);
        await page.type("#username", this.email, {
          delay: 50,
        });
      }
    }
    await page.type("#password", this.password, { delay: 50 });

    await page.click('button[type="submit"]');
    try {
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
    } catch (error) {
      console.log("navigation error", error);
      await page.reload();
      await page.waitForTimeout(3000);
    }

    await page.reload();
    await page.waitForTimeout(3000);
    let netError = await this.checkForNetErrorPage(page);
    if (netError) {
      await page.reload();
      await page.waitForTimeout(2000);
    }
  }

  async enterOTP(page, otp = "") {
    const tryAnotherWay = await page.$("#try-another-way");
    if (tryAnotherWay) {
      await tryAnotherWay.click();
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 7000,
      });
    }

    const otpPinInput = await page.$("#input__phone_verification_pin");
    const otpEmailInput = await page.$("#input__email_verification_pin");

    console.log("Starting OTP verification process...");

    if (otpPinInput) {
      console.log("OTP verification via phone...");

      console.log(`Received OTP: ${otp}`);

      await page.type("#input__phone_verification_pin", otp, { delay: 50 });
      console.log("OTP entered, submitting form...");

      await page.click('button[type="submit"]');
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 7000,
      });

      //   const urlAfterOtp = await page.url();
      //   console.log(`Navigated to URL: ${urlAfterOtp}`);

      //   if (urlAfterOtp.includes("checkpoint")) {
      //     console.log("Challenges checkpoint detected");
      //     await promptForOTP();
      //   }
    } else if (otpEmailInput) {
      console.log("OTP verification via email...");

      console.log(`Received OTP: ${otp}`);

      await page.type("#input__email_verification_pin", otp, { delay: 50 });
      console.log("OTP entered, submitting form...");

      await page.click('button[type="submit"]');
      try {
        await page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
      } catch (error) {
        console.log("navigation error in otp", error);
        await page.reload();
        await page.waitForTimeout(3000);
      }

      await page.waitForTimeout(3000);
      //   const urlAfterOtp = await page.url();
      //   console.log(`Navigated to URL: ${urlAfterOtp}`);

      //   if (urlAfterOtp.includes("checkpoint")) {
      //     console.log("Challenges checkpoint detected");
      //     await promptForOTP();
      //   }
    } else {
      console.log("otp not entered");
    }

    let netError = await this.checkForNetErrorPage(page);
    if (netError) {
      await page.reload();
      await page.waitForTimeout(3000);
    }
  }

  async startloginprocess(page) {
    let isFeedPage = false;
    let isCaptchaPage = false;
    let isOtpPage = false;
    let isNotifyPage = false;
    let isLoginPage = false;
    let isWrongPasswordPage = false;
    let isWrongOtp = false;
    let isNetErrorPage = false;
    let isUnknownPage = false;

    const url = await page.url();
    console.log("url in start of login function :", url);
    if (url.includes("chrome-error://chromewebdata")) {
      console.log("inside chrome error");
      await page.reload();
      await page.waitForTimeout(4000);
    }

    if (!url.includes("linkedin.com/feed")) {
      console.log("inside if");

      const ispass = await page.$("#password");
      const wrongPassword = await page.$("#error-for-password");
      const wrongUsername = await page.$("#error-for-username");
      let wrongPasswordText = "";
      let wrongUsernameText = "";
      if (wrongPassword) {
        wrongPasswordText = await page.evaluate(() => {
          const element = document.querySelector("#error-for-password");
          return element ? element.textContent.trim() : "";
        });
      }

      if (wrongUsername) {
        wrongUsernameText = await page.evaluate(() => {
          const element = document.querySelector("#error-for-username");
          return element ? element.textContent.trim() : "";
        });
      }
      const inputPin = await page.$(
        `input[aria-label="Please enter the code here"]`
      );
      const otpPinInput = await page.$("#input__phone_verification_pin");
      const otpEmailInput = await page.$("#input__email_verification_pin");

      const captchaHeading = await page.$(`main h1`);
      let captchaHeadingText = "";
      if (captchaHeading) {
        captchaHeadingText = await page.evaluate(() => {
          const element = document.querySelector("main h1");
          return element ? element.textContent.trim() : "";
        });
      }
      const captchaId1 = await page.$("#captch-internal");
      const captchaId2 = await page.$("#captch-challenge");
      const captchaId3 = await page.$(`[title="Captcha Challenge"]`);
      const captchaId4 = await page.$("#FunCaptcha");
      const captchaId5 = await page.$(
        `[aria-label="Verify Visual challenge."]`
      );

      let netError = await this.checkForNetErrorPage(page);

      // isNetErrorPage = await this.checkForNetErrorPage(page);

      if (ispass && (wrongPasswordText != "" || wrongUsernameText != "")) {
        console.log("wrong password");
        isWrongPasswordPage = true;
      } else if (ispass) {
        console.log("put credentials..");
        isLoginPage = true;
      } else if (inputPin || otpPinInput || otpEmailInput) {
        const errorOTP = await page.$(`div[error-for="verificationPin"]`);

        const wrongOtpBanner = await page.$(`.body__banner--error span`);
        let wrongOtpBannerText = "";
        if (wrongOtpBanner) {
          wrongOtpBannerText = await page.evaluate(() => {
            const element = document.querySelector(`.body__banner--error span`);
            return element ? element.textContent.trim() : "";
          });
        }
        if (errorOTP) {
          let errorText = await page.evaluate(() => {
            const element = document.querySelector(
              `div[error-for="verificationPin"]`
            );
            return element ? element.textContent.trim() : "";
          });
          console.log("errorText", errorText);
          if (errorText) {
            console.log("wrong otp");
            isWrongOtp = true;
          } else {
            console.log("otp page");
            isOtpPage = true;
          }
        } else if (wrongOtpBannerText.includes("try again")) {
          isWrongOtp = true;
        } else {
          console.log("otp required");
          isOtpPage = true;
        }
      } else if (url.includes("checkpoint/challengesV2/")) {
        // const headingRef = await page.$(".header__content");
        console.log("inside app verification checking..");
        const text = await page.evaluate(() => {
          const element = document.querySelector(".header__content h1");
          return element ? element.textContent.trim() : "";
        });

        const text2 = await page.evaluate(() => {
          const element = document.querySelector(
            "h1.header__content__heading__inapp"
          );
          return element ? element.textContent.trim() : "";
        });

        console.log("text for app verificatrion :", text);
        if (
          text == "Check your LinkedIn app" ||
          text2 == "Check your LinkedIn app"
        ) {
          console.log("linkedin app notification required");
          isNotifyPage = true;
        }
      } else if (
        captchaHeadingText.includes("security check") ||
        captchaId1 ||
        captchaId2 ||
        captchaId3 ||
        captchaId4 ||
        captchaId5
      ) {
        isCaptchaPage = true;
      } else if (netError) {
        isNetErrorPage = true;
      } else {
        isUnknownPage = true;
      }

      if (isLoginPage) {
        console.log("logging in..");
        await this.updateDB("CREDENTIALS_PUT");
        await this.putLoginCredentials(page);
        await page.waitForTimeout(2000);
      } else if (isOtpPage) {
        console.log("otp request..");
        await this.updateDB("OTP_REQUESTED");
        let waitTime = 90000;
        let otp = "";
        while (waitTime > 0) {
          // fetch the otp from the user
          let otpStatus = await this.findstatus();
          if (otpStatus == "OTP_SUBMITTED") {
            const User = await userModel.findOne({
              _id: this.userId,
            });
            otp = User.liOtp;
            break;
          } else if (otpStatus == "ABORTED") {
            throw new Error("ongoing login aborted");
          }

          await delay(4000);
          waitTime = waitTime - 4000;
        }
        if (otp) {
          await this.enterOTP(page, otp);
        } else {
          throw new Error("otp not entered");
        }
      } else if (isWrongPasswordPage) {
        console.log("wrong password..");
        await this.updateDB("WRONG_PASSWORD");
        let waitTime = 70000;
        let newPass = false;
        while (waitTime > 0) {
          // fetch the otp from the user
          let passStatus = await this.findstatus();
          if (passStatus == "CREDENTIALS_PUT") {
            const user = await userModel.findOne({
              _id: this.userId,
            });
            newPass = true;
            this.email = user.liId;
            this.password = user.liPass;
            break;
          } else if (passStatus == "ABORTED") {
            throw new Error("ongoing login aborted");
          }

          await delay(4000);
          waitTime = waitTime - 4000;
        }

        if (newPass) await this.putLoginCredentials(page);
        else {
          throw new Error("no new password given");
        }
      } else if (isNotifyPage) {
        console.log("app notification ..");
        await this.updateDB("APP_VERIFICATION");
        let waitTime = 90000;
        let clickedYes = false;
        while (waitTime > 0) {
          await delay(5000);
          // await page.reload();
          //   await page.waitForTimeout(2000);
          const appStatus = await this.findstatus();
          if (appStatus == "ABORTED") {
            throw new Error("ongoing login aborted");
          }
          let netError1 = await this.checkForNetErrorPage(page);
          if (netError1) {
            console.log("page while app verification reloaded...");
            await page.reload();
            await page.waitForTimeout(4000);
          }
          const pageurl = await page.url();
          if (pageurl.includes("linkedin.com/feed")) {
            clickedYes = true;
            break;
          }
          waitTime = waitTime - 5000;
        }

        if (clickedYes) {
          await this.updateDB("SUCCESS");
        } else {
          await page.reload();
          throw new Error("clicked yes");
        }
      } else if (isCaptchaPage) {
        console.log("captcha solving...");
        try {
          // Wait for the outer iframe to be available
          await userModel.updateOne(
            {
              _id: this.userId,
            },
            {
              iframeUrl: "",
            }
          );
          await page.waitForSelector("iframe#captcha-internal", {
            timeout: 5000,
          });

          // Get the outer iframe element
          const outerIframeElement = await page.$("iframe#captcha-internal");

          if (outerIframeElement) {
            // Get the frame object of the outer iframe
            const outerFrame = await outerIframeElement.contentFrame();

            // Wait for the inner iframe to load inside the outer iframe
            await outerFrame.waitForSelector("iframe#arkoseframe", {
              timeout: 5000,
            });

            // Get the inner iframe element
            const innerIframeElement = await outerFrame.$("iframe#arkoseframe");

            if (innerIframeElement) {
              // Retrieve the 'src' attribute value of the inner iframe
              const captchaUrl = await outerFrame.evaluate(
                (el) => el.src,
                innerIframeElement
              );

              await userModel.updateOne(
                {
                  _id: this.userId,
                },
                {
                  iframeUrl: captchaUrl,
                }
              );
              //   return { captchaUrl };
            } else {
              console.log("Iframe with id arkoseframe not found.");
            }
          } else {
            console.log("Iframe with id captcha-internal not found.");
          }
        } catch (error) {
          console.error("Error accessing iframes:", error);
          logtail.info(`Error accessing iframes for user ${this.userId}`);
        }
        await this.updateDB("CAPTCHA_REQUESTED");
        let waitTime = 90000;
        let captchaVerifyTime = 90000;
        // let captchaVerified = false;
        let captchaSolved = false;
        let captchaToken = "";
        let captchaStatus = await this.findstatus();
        while (captchaVerifyTime > 0) {
          console.log("captcha status :", captchaStatus);
          if (captchaStatus == "CAPTCHA_SOLVED") {
            console.log("fetch the verify token from the DB");
            const userWithToken = await userModel.findOne({ _id: this.userId });
            captchaToken = userWithToken?.liCaptchaVerificationToken || "";
            break;
          } else if (captchaStatus == "ABORTED") {
            throw new Error("ongoing login aborted");
          }

          await delay(4000);
          captchaStatus = await this.findstatus();
          captchaVerifyTime = captchaVerifyTime - 4000;
        }

        if (captchaToken) {
          console.log("captcha verifying started by token");
          await this.verifyCaptcha(page, captchaToken);
          await page.reload();
        }

        await page.waitForTimeout(3000);

        let netError2 = await this.checkForNetErrorPage(page);
        if (netError2) {
          console.log("page after verification token reloaded...");
          await page.reload();
          await page.waitForTimeout(2000);
        }

        const captcha1 = await page.$("#captch-internal");
        const captcha2 = await page.$("#captch-challenge");
        const captcha3 = await page.$(`[title="Captcha Challenge"]`);
        const captcha4 = await page.$("#FunCaptcha");
        const captcha5 = await page.$(
          `[aria-label="Verify Visual challenge."]`
        );
        const loginurl = await page.url();
        if (
          !loginurl.includes("linkedin.com/feed") &&
          (captcha1 || captcha2 || captcha3 || captcha4 || captcha5)
        ) {
          console.log(
            "captcha not verified with token , need to do it manually"
          );
          while (waitTime > 0) {
            await delay(5000);
            const abortStatus = await this.findstatus();
            if (abortStatus == "ABORTED") {
              throw new Error("ongoing login aborted");
            }
            let pageurl = await page.url();
            if (pageurl.includes("linkedin.com/feed")) {
              await page.reload();
              pageurl = await page.url();
              if (pageurl.includes("linkedin.com/feed")) {
                captchaSolved = true;
                break;
              }
            }
            waitTime = waitTime - 5000;
          }
          // await page.reload();
        } else {
          console.log("captcha solved and waiting to identify the next page");
          await this.updateDB("IN_PROGRESS");
        }

        if (captchaSolved) {
          await this.updateDB("SUCCESS");
        } else {
          throw new Error("no feed page after captcha");
        }
      } else if (isFeedPage) {
        console.log("already logged in..");
        await this.updateDB("SUCCESS");
      } else if (isWrongOtp) {
        console.log("wrong otp..");
        await this.updateDB("OTP_INCORRECT");
        let waitTime = 60000;
        let otp = "";
        while (waitTime > 0) {
          // fetch the otp from the user
          let otpStatus = await this.findstatus();
          if (otpStatus == "OTP_SUBMITTED") {
            const User = await userModel.findOne({
              _id: this.userId,
            });
            otp = User.liOtp;
            break;
          } else if (otpStatus == "ABORTED") {
            throw new Error("ongoing login aborted");
          }

          await delay(4000);
          waitTime = waitTime - 4000;
        }
        if (otp) {
          await this.enterOTP(page, otp);
        } else {
          throw new Error("no new otp given");
        }
      } else if (isNetErrorPage) {
        console.log("site can't be reached page occured");
        await page.reload();
        await page.waitForTimeout(2000);
      } else if (isUnknownPage) {
        console.log("unknown page...");
        await takeScreenshot(page, "auth");
        await page.reload();
        await page.waitForTimeout(4000);
        throw new Error("unknown page");
        // await this.updateDB("FAILED"); //need to ask whether to apply it here
      }

      const notReachedPage = await this.checkForNetErrorPage(page);
      if (notReachedPage) {
        console.log("page not reached! reload for one more time");
        await page.reload();
      }

      const finalurl = await page.url();
      if (finalurl.includes("linkedin.com/feed")) {
        console.log("login successfull...");
        await this.updateDB("SUCCESS");
      }
      await page.waitForTimeout(2000);
    } else {
      // Already logged in
      console.log("inside else");
      await page.waitForTimeout(5000);
      console.log("Logged in successfully.");

      isFeedPage = true;
      await this.updateDB("SUCCESS");
    }
  }

  /**
   * Create a Puppeteer page with setting up cookies.
   */
  async createPage() {
    if (!this.browser) {
      throw new Error("Browser not set.");
    }
    // Important: Do not block "stylesheet", makes the crawler not work for LinkedIn
    const blockedResources = [
      "image",
      "media",
      "font",
      "texttrack",
      "manifest",
    ];

    try {
      const page = await this.browser.newPage();

      const session = await page.target().createCDPSession();
      await page.setBypassCSP(true);
      await session.send("Page.enable");
      await session.send("Page.setWebLifecycleState", {
        state: "active",
      });

      const blockedUrls = ["https://www.linkedin.com/li/track"];

      // Block loading of resources, like images and css, we dont need that
      await page.setRequestInterception(true);

      page.on("request", (req) => {
        if (req.isNavigationRequest() && req.redirectChain().length) {
          return req.abort();
        }

        if (blockedResources.includes(req.resourceType())) {
          return req.abort();
        }

        if (blockedUrls.includes(req.url())) {
          return req.abort();
        }

        return req.continue();
      });

      await page.setViewport({
        width: 1200,
        height: 720,
      });

      // const cookies = [];

      // if (this.bCookie) {
      //   cookies.push({
      //     name: "bcookie",
      //     value: this.bCookie,
      //     domain: ".www.linkedin.com",
      //   });
      // }

      // if (this.bsCookie) {
      //   cookies.push({
      //     name: "bscookie",
      //     value: this.bsCookie,
      //     domain: ".www.linkedin.com",
      //   });
      // }

      // if (cookies.length) {
      //   await page.setCookie(...cookies);
      // }

      // await page.waitForTimeout(5000);
      // await page.reload();
      //   await page.goto("https://www.linkedin.com/", {
      //     waitUntil: "domcontentloaded",
      //   });
      await this.navigateToProfile(page);

      const feedurl = await page.url();

      if (!feedurl.includes("linkedin.com/feed")) {
        await page.goto("https://www.linkedin.com/login/", {
          waitUntil: "domcontentloaded",
        });
      }

      // https://www.linkedin.com/checkpoint/lg/login-submit

      await page.waitForTimeout(5000);

      return page;
    } catch (err) {
      Sentry.captureException(err);
      await this.close();
      throw err;
    }
  }

  async start() {
    let page;
    try {
      if (!this.browser) {
        throw new Error(
          "Browser is not set. Please run the setup method first."
        );
      }

      page = await this.createPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)\
   Chrome/85.0.4183.83 Safari/537.36"
      );

      // Modify navigator properties
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
      });

      //   const url = await page.url();
      //   console.log("url :", url);
      let status = await this.findstatus();
      console.log("status before while loop :", status);
      let retry = 0;
      let retryUnknownPage = 0;
      while (status !== "SUCCESS" && retry < 10) {
        console.log("status inside while loop :", status);
        try {
          await this.startloginprocess(page);
          // await page.reload();
        } catch (err) {
          logtail.info(
            `VM ID - ${process.env.VM_ID} - error in processing the li page for user ${this.userId} - ${err.message}`
          );
          console.log("error on processing the li page", err.message);
          const errMsg = err.message;
          if (errMsg == "ongoing login aborted") {
            console.log("Ongoing login aborted breaking the loop");
            status = "ABORTED";
            break;
          } else if (errMsg == "unknown page") {
            retryUnknownPage = retryUnknownPage + 1;
            if (retryUnknownPage > 3) {
              console.log("do not retry the unknown page");
              retry = 10;
              await this.updateDB("FAILED");
              status = "FAILED";
              break;
            }
          }
        }

        status = await this.findstatus();

        // for testing purpose
        if (
          status == "CAPTCHA_REQUESTED" ||
          status == "APP_VERIFICATION" ||
          status == "FAILED" ||
          status == "CAPTCHA_SOLVED" ||
          status == "ABORTED"
        ) {
          console.log(`Do not try to reattempt the status : ${status}`);
          break;
        }

        await delay(3000);
        retry = retry + 1;
      }

      if (status == "SUCCESS") {
        console.log("logged in successfully");
        logtail.info(`Authorization successfull for user ${this.userId}`);

        const cookies = await page.cookies();
        const liCookie = cookies.find(({ name }) => name === "li_at").value;
        const bCookie = cookies.find(({ name }) => name === "bcookie").value;
        const bsCookie = cookies.find(({ name }) => name === "bscookie").value;

        console.log("liCookie", liCookie);
        console.log("bCookie", bCookie);
        console.log("bsCookie", bsCookie);
        await userModel.updateOne(
          {
            _id: this.userId,
          },
          {
            liCookie: liCookie,
            bCookie: bCookie,
            bsCookie: bsCookie,
            isLiCookieExpired: false,
          }
        );
      } else if (status == "ABORTED") {
        logtail.info(`Authorization aborted for user ${this.userId}`);
        console.log(`Authorization aborted for user ${this.userId}`);
        await this.updateDB("ABORTED");
      } else {
        logtail.info(`Authorization failed for user ${this.userId}`);
        console.log(`failed to authroize the user ${this.userId}`);
        await this.updateDB("FAILED");
      }

      console.log("waiting...");
      await page.waitForTimeout(2000);
      return {
        linkedinAuthStatus: status,
      };
    } catch (err) {
      Sentry.captureException(err);
      await this.updateDB("FAILED");
      await takeScreenshot(page, "auth");
      console.log("Error::", err);
      // await this.close();
      return {
        error: err.message,
      };
    }
  }
}

// (async () => {
//   const linkedInLoginScraper = new LinkedInBrowserLoginScraper(
//     // "cary@akcoastalconnections.com",
//     // "testing123",
//     // "AQEDAQUjJbEBEzOoAAABkdadGx8AAAGR-qmfH04AZ7qAaaX-rSkQdYo-rnZqF8mAh8fslYyXsO9pjU0RDT_oeOTsGbBS_gp7ucWJBvaKaaUmaWYWrjqlpROlH1E96_meEK_2cAswt8HHenT3FZJl3s7B",
//     // "v=2&a2928ff7-d50e-4906-85fc-4412806eb7a3",
//     // "v=1&20240715174602a345986d-4f87-41a0-8161-9665e450d0edAQEropywAy5Oxtcz7pCQOdEtjNC2UOqB",
//     // "byronsolvason@gmail.com",
//     // "testing123",
//     // "AQEDARVVlvoCIeFCAAABkWw3W6QAAAGRkEPfpFYAfNx5eVTYQ_DjHVC7vxrTlQf74iDqTATqjrN-iLewvVvnFHHlXUCsA-VuQxZY4Zn0BC52ssKcYyr_N1eHBcg9czrs8EW2lDBrQ0VGHfK_-U_ChCMv",
//     // "v=2&84cc8d1a-6ec6-42bf-8e45-15a71976342c",
//     // "v=1&2024081919481034c6b8d7-f75d-4e9e-87d0-7065d09df090AQFhEgs8wZo0IWC3gmUOIDYd5DuENmTU"
//     // "ajharshit0111@gmail.com",
//     // "testingharshit",
//     // "AQEDASiWQNwEg2x9AAABkdZ8c3cAAAGR-oj3d00AP3cYI33PGYtDTXQ8dKpvsxU22Y_uACYD8LxwPx7l2is8WEu-2NUrff7u-Bxaj2UZVeyqnS4Fs_-_PdpGq5jPBL1xqR7mqRgHXVZf8mW0YkgGAhb0",
//     // "v=2&b6501992-d8d4-48af-8833-b14fe7726ed2",
//     // "v=1&202408071232260130e6e3-da0b-4055-80c9-580ee1a0c8a9AQHlKbaSn2SJ8hALaEjcRxyY0kviTZZ_"
//     "",
//     "20ucs180@lnmiit.ac.in",
//     "testing",
//     "",
//     "",
//     "1309"
//   );
//   await linkedInLoginScraper.setup();
//   const result = await linkedInLoginScraper.start();
//   //   await linkedInLoginScraper.close();
//   console.log("🚀 ~ file: linkedInLoginScraper.js:152 ~ result:", result);
// })();

module.exports = {
  LinkedInBrowserLoginScraper,
};
