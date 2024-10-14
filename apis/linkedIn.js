const Client = require("../core/client");
const helpers = require("../utils/helpers");
const { v4: uuidv4 } = require("uuid");

class LinkedIn {
  constructor(username, password, options = {}) {
    const {
      authenticate = true,
      refreshCookies = false,
      debug = false,
      proxies = {},
      cookies = null,
      cookiesDir = "",
    } = options;

    this.client = new Client({
      refreshCookies,
      debug,
      proxies,
      cookiesDir,
    });

    this.logger = console;
    if (debug) {
      this.logger.level = "debug";
    }

    if (authenticate) {
      if (cookies) {
        this.client.setSessionCookies(cookies);
      } else {
        this.client.authenticate(username, password);
      }
    }
  }

  async _fetch(
    uri,
    evade = this.defaultEvade,
    baseRequest = false,
    options = {}
  ) {
    await evade();
    const url = `${
      baseRequest ? this.client.LINKEDIN_BASE_URL : this.client.API_BASE_URL
    }${uri}`;
    try {
      const response = await this.client.session.get(url, options);
      return response;
    } catch (error) {
      this.logger.debug("Fetch error:", error);
      throw error;
    }
  }

  _cookies() {
    return this.client.cookies;
  }

  _headers() {
    return this.client.REQUEST_HEADERS;
  }

  async _post(
    uri,
    evade = this.defaultEvade,
    baseRequest = false,
    options = {}
  ) {
    await evade();
    const url = `${
      baseRequest ? this.client.LINKEDIN_BASE_URL : this.client.API_BASE_URL
    }${uri}`;
    try {
      const response = await this.client.session.post(
        url,
        options.data,
        options
      );
      return response;
    } catch (error) {
      this.logger.debug("Post error:", error);
      throw error;
    }
  }

  defaultEvade() {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.floor(Math.random() * 3000) + 2000)
    );
  }

  async getProfile(publicId = null, urnId = null) {
    const res = await this._fetch(
      `/identity/profiles/${publicId || urnId}/profileView`
    );
    const data = res.data;

    if (data && data.status && data.status !== 200) {
      this.logger.info(`request failed: ${data.message}`);
      return {};
    }

    const profile = data.profile;
    if (profile.miniProfile) {
      if (profile.miniProfile.picture) {
        profile.displayPictureUrl =
          profile.miniProfile.picture[
            "com.linkedin.common.VectorImage"
          ].rootUrl;
        const imagesData =
          profile.miniProfile.picture["com.linkedin.common.VectorImage"]
            .artifacts;
        for (const img of imagesData) {
          const { width, height, fileIdentifyingUrlPathSegment } = img;
          profile[`img_${width}_${height}`] = fileIdentifyingUrlPathSegment;
        }
      }

      profile.profile_id = helpers.getIdFromUrn(profile.miniProfile.entityUrn);
      profile.profile_urn = profile.miniProfile.entityUrn;
      profile.member_urn = profile.miniProfile.objectUrn;
      profile.public_id = profile.miniProfile.publicIdentifier;

      delete profile.miniProfile;
    }

    delete profile.defaultLocale;
    delete profile.supportedLocales;
    delete profile.versionTag;
    delete profile.showEducationOnProfileTopCard;

    // Process experience data
    const experience = data.positionView.elements;
    for (const item of experience) {
      if (item.company && item.company.miniCompany) {
        if (item.company.miniCompany.logo) {
          const logo =
            item.company.miniCompany.logo["com.linkedin.common.VectorImage"];
          if (logo) {
            item.companyLogoUrl = logo.rootUrl;
          }
        }
        delete item.company.miniCompany;
      }
    }
    profile.experience = experience;

    // Process education data
    const education = data.educationView.elements;
    for (const item of education) {
      if (item.school && item.school.logo) {
        item.school.logoUrl =
          item.school.logo["com.linkedin.common.VectorImage"].rootUrl;
        delete item.school.logo;
      }
    }
    profile.education = education;

    // Process languages data
    const languages = data.languageView.elements;
    for (const item of languages) {
      delete item.entityUrn;
    }
    profile.languages = languages;

    // Process publications data
    const publications = data.publicationView.elements;
    for (const item of publications) {
      delete item.entityUrn;
      for (const author of item.authors || []) {
        delete author.entityUrn;
      }
    }
    profile.publications = publications;

    // Process certifications data
    const certifications = data.certificationView.elements;
    for (const item of certifications) {
      delete item.entityUrn;
    }
    profile.certifications = certifications;

    // Process volunteer data
    const volunteer = data.volunteerExperienceView.elements;
    for (const item of volunteer) {
      delete item.entityUrn;
    }
    profile.volunteer = volunteer;

    // Process honors data
    const honors = data.honorView.elements;
    for (const item of honors) {
      delete item.entityUrn;
    }
    profile.honors = honors;

    // Process projects data
    const projects = data.projectView.elements;
    for (const item of projects) {
      delete item.entityUrn;
    }
    profile.projects = projects;

    // Process skills data
    const skills = data.skillView.elements;
    for (const item of skills) {
      delete item.entityUrn;
    }
    profile.skills = skills;

    profile.urn_id = profile.entityUrn.replace("urn:li:fs_profile:", "");

    return profile;
  }

  async getUserProfile(useCache = true) {
    let meProfile = this.client.metadata.me || {};
    if (!this.client.metadata.me || !useCache) {
      const res = await this._fetch("/me");
      meProfile = res.data;
      this.client.metadata.me = meProfile;
    }
    return meProfile;
  }

  async getInvitations(start = 0, limit = 3) {
    const params = {
      start,
      count: limit,
      includeInsights: true,
      q: "receivedInvitation",
    };

    const res = await this._fetch("/relationships/invitationViews", { params });

    if (res.status !== 200) {
      return [];
    }

    const responsePayload = res.data;
    return responsePayload.elements.map((element) => element.invitation);
  }

  async replyInvitation(
    invitationEntityUrn,
    invitationSharedSecret,
    action = "accept"
  ) {
    const invitationId = helpers.getIdFromUrn(invitationEntityUrn);
    const params = { action };
    const payload = {
      invitationId,
      invitationSharedSecret,
      isGenericInvitation: false,
    };

    const res = await this._post(
      `/relationships/invitations/${invitationId}`,
      this.defaultEvade,
      false,
      {
        params,
        data: payload,
      }
    );

    return res.status === 200;
  }

  async addConnection(profilePublicId, message = "", profileUrn = null) {
    if (message.length > 300) {
      this.logger.info("Message too long. Max size is 300 characters");
      return false;
    }

    if (!profileUrn) {
      const profile = await this.getProfile(profilePublicId);
      profileUrn = profile.profile_urn.split(":").pop();
    }

    const trackingId = helpers.generateTrackingId();
    const payload = {
      trackingId,
      message,
      invitations: [],
      excludeInvitations: [],
      invitee: {
        "com.linkedin.voyager.growth.invitation.InviteeProfile": {
          profileId: profileUrn,
        },
      },
    };
    try {
      const res = await this._post(
        "/growth/normInvitations",
        this.defaultEvade,
        false,
        {
          data: payload,
          headers: { accept: "application/vnd.linkedin.normalized+json+2.1" },
        }
      );

      return res;
    } catch (err) {
      return err?.response?.data;
    }
  }

  async removeConnection(publicProfileId) {
    const res = await this._post(
      `/identity/profiles/${publicProfileId}/profileActions?action=disconnect`,
      this.defaultEvade,
      false,
      {
        headers: { accept: "application/vnd.linkedin.normalized+json+2.1" },
      }
    );

    return res.status !== 200;
  }

  async track(eventBody, eventInfo) {
    const payload = { eventBody, eventInfo };
    const res = await this._post("/li/track", this.defaultEvade, true, {
      headers: {
        accept: "*/*",
        "content-type": "text/plain;charset=UTF-8",
      },
      data: JSON.stringify(payload),
    });

    return res.status !== 200;
  }

  async getConversationDetails(profileUrnId) {
    const res = await this._fetch(
      `/messaging/conversations?keyVersion=LEGACY_INBOX&q=participants&recipients=List(${profileUrnId})`
    );
    const data = res.data;

    if (data.elements.length === 0) {
      return {};
    }

    const item = data.elements[0];
    item.id = helpers.getIdFromUrn(item.entityUrn);

    return item;
  }

  async getConversations() {
    const params = { keyVersion: "LEGACY_INBOX" };
    const res = await this._fetch("/messaging/conversations", { params });
    return res.data;
  }

  async getConversation(conversationUrnId) {
    const res = await this._fetch(
      `/messaging/conversations/${conversationUrnId}/events`
    );
    return res.data;
  }

  async sendMessage(messageBody, conversationUrnId = null, recipients = null) {
    const params = { action: "create" };

    if (!(conversationUrnId || recipients)) {
      this.logger.debug("Must provide [conversation_urn_id] or [recipients].");
      return true;
    }

    const messageEvent = {
      eventCreate: {
        originToken: uuidv4().toString(),
        value: {
          "com.linkedin.voyager.messaging.create.MessageCreate": {
            attributedBody: {
              text: messageBody,
              attributes: [],
            },
            attachments: [],
          },
        },
        trackingId: helpers.generateTrackingIdAsCharString(),
      },
      dedupeByClientGeneratedToken: false,
    };

    let res;
    if (conversationUrnId && !recipients) {
      res = await this._post(
        `/messaging/conversations/${conversationUrnId}/events`,
        this.defaultEvade,
        false,
        {
          params,
          data: messageEvent,
        }
      );
    } else if (recipients && !conversationUrnId) {
      messageEvent.recipients = recipients;
      messageEvent.subtype = "MEMBER_TO_MEMBER";
      const payload = {
        keyVersion: "LEGACY_INBOX",
        conversationCreate: messageEvent,
      };
      res = await this._post(
        "/messaging/conversations",
        this.defaultEvade,
        false,
        {
          params,
          data: payload,
        }
      );
    }

    return res;
  }

  async markConversationAsSeen(conversationUrnId) {
    const payload = { patch: { $set: { read: true } } };
    const res = await this._post(
      `/messaging/conversations/${conversationUrnId}`,
      this.defaultEvade,
      false,
      {
        data: payload,
      }
    );

    return res.status !== 200;
  }
}

module.exports = LinkedIn;
