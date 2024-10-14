const crypto = require("crypto");

function getIdFromUrn(urn) {
  return urn.split(":")[3];
}

function getUrnFromRawUpdate(rawString) {
  return rawString.split("(")[1].split(",")[0];
}

function getUpdateAuthorName(dIncluded) {
  try {
    return dIncluded.actor.name.text;
  } catch (error) {
    if (error instanceof TypeError) {
      return "None";
    }
    return "";
  }
}

function getUpdateOld(dIncluded) {
  try {
    return dIncluded.actor.subDescription.text;
  } catch (error) {
    if (error instanceof TypeError) {
      return "None";
    }
    return "";
  }
}

function getUpdateContent(dIncluded, baseUrl) {
  try {
    return dIncluded.commentary.text.text;
  } catch (error) {
    if (error instanceof TypeError) {
      try {
        const urn = getUrnFromRawUpdate(dIncluded["*resharedUpdate"]);
        return `${baseUrl}/feed/update/${urn}`;
      } catch (innerError) {
        if (innerError instanceof TypeError) {
          return "None";
        }
        return "IMAGE";
      }
    }
    return "";
  }
}

function getUpdateAuthorProfile(dIncluded, baseUrl) {
  let urn = "";
  try {
    urn = dIncluded.actor.urn;
  } catch (error) {
    if (error instanceof TypeError) {
      return "None";
    }
    return "";
  }

  const urnId = urn.split(":").pop();
  if (urn.includes("company")) {
    return `${baseUrl}/company/${urnId}`;
  } else if (urn.includes("member")) {
    return `${baseUrl}/in/${urnId}`;
  }
  return urn;
}

function getUpdateUrl(dIncluded, baseUrl) {
  try {
    const urn = dIncluded.updateMetadata.urn;
    return `${baseUrl}/feed/update/${urn}`;
  } catch (error) {
    if (error instanceof TypeError) {
      return "None";
    }
    return "";
  }
}

function appendUpdatePostFieldToPostsList(
  dIncluded,
  lPosts,
  postKey,
  postValue
) {
  const elementsCurrentIndex = lPosts.length - 1;

  if (elementsCurrentIndex === -1) {
    lPosts.push({ [postKey]: postValue });
  } else {
    if (!(postKey in lPosts[elementsCurrentIndex])) {
      lPosts[elementsCurrentIndex][postKey] = postValue;
    } else {
      lPosts.push({ [postKey]: postValue });
    }
  }
  return lPosts;
}

function parseListRawUrns(lRawUrns) {
  return lRawUrns.map(getUrnFromRawUpdate);
}

function parseListRawPosts(lRawPosts, linkedinBaseUrl) {
  let lPosts = [];
  for (const i of lRawPosts) {
    const authorName = getUpdateAuthorName(i);
    if (authorName) {
      lPosts = appendUpdatePostFieldToPostsList(
        i,
        lPosts,
        "author_name",
        authorName
      );
    }

    const authorProfile = getUpdateAuthorProfile(i, linkedinBaseUrl);
    if (authorProfile) {
      lPosts = appendUpdatePostFieldToPostsList(
        i,
        lPosts,
        "author_profile",
        authorProfile
      );
    }

    const old = getUpdateOld(i);
    if (old) {
      lPosts = appendUpdatePostFieldToPostsList(i, lPosts, "old", old);
    }

    const content = getUpdateContent(i, linkedinBaseUrl);
    if (content) {
      lPosts = appendUpdatePostFieldToPostsList(i, lPosts, "content", content);
    }

    const url = getUpdateUrl(i, linkedinBaseUrl);
    if (url) {
      lPosts = appendUpdatePostFieldToPostsList(i, lPosts, "url", url);
    }
  }
  return lPosts;
}

function getListPostsSortedWithoutPromoted(lUrns, lPosts) {
  const lPostsSortedWithoutPromoted = [];
  lPosts = lPosts.filter((d) => d && !d.old?.includes("Promoted"));

  for (const urn of lUrns) {
    for (let i = 0; i < lPosts.length; i++) {
      const post = lPosts[i];
      if (post.url?.includes(urn)) {
        lPostsSortedWithoutPromoted.push(post);
        lPosts.splice(i, 1);
        break;
      }
    }
  }
  return lPostsSortedWithoutPromoted;
}

function generateTrackingIdAsCharString() {
  const randomIntArray = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
  );
  return String.fromCharCode(...randomIntArray);
}

function generateTrackingId() {
  const randomIntArray = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
  );
  const randByteArray = Buffer.from(randomIntArray);
  return randByteArray.toString("base64");
}

module.exports = {
  getIdFromUrn,
  getUrnFromRawUpdate,
  getUpdateAuthorName,
  getUpdateOld,
  getUpdateContent,
  getUpdateAuthorProfile,
  getUpdateUrl,
  appendUpdatePostFieldToPostsList,
  parseListRawUrns,
  parseListRawPosts,
  getListPostsSortedWithoutPromoted,
  generateTrackingIdAsCharString,
  generateTrackingId,
};
