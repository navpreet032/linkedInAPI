const LinkedIn = require("../apis/linkedIn");

const ID = "vinay.prajapati@hirequotient.com";
const PASS = "AmitShah@best";
const vineet = "ACoAACjxfEwBS4hknepIIq4P4fLYjMzlkGik7Wk";
const shekhar = "ACoAADN7EbgB2EcydDMqeeAW8zisDTy3k0hS5tI";

async function main() {
  const linkedin = new LinkedIn(ID, PASS, {
    debug: true,
    cookiesDir: "./cookies",
    // defaultUserAgent: "My Custom User Agent",
    // authUserAgent: "My Custom Auth User Agent",
  });
  try {
    // const profile = await linkedin.getProfile("shekhar-bansal-4a0304201");
    // console.log("Profile:", profile);
    // const res = await linkedin.addConnection(
    //   shekhar,
    //   "Hello, I would love to connect"
    // );
    // console.log("res", res);
    const chatDetails = await linkedin.getConversationDetails(vineet);
    console.log("chatDetails", chatDetails);
  } catch (err) {
    console.log("err", err);
  }
}

// async function main() {
//   const li = new LinkedIn("preetpannu032@gmail.com", "lpuiamin", {
//     debug: true,
//   });
//   // nav032 : ACoAADJzM0sBKn1nK62SnxZ6a1R_QWvElDfRAGY
//   try {
//     // const profile = await li.getProfile("varunsharma2501");
//     // console.log("Profile:", profile);

//     // const inviteSent = await li.addConnection("nav032");
//     // console.log("Invite sent:", inviteSent);

//     const messageSent = await li.sendMessage("Hello, Varun", null, [
//       "ACoAADf7X2cBpifhEldMcaEqFsliQL7SETtApDc",
//     ]);
//     console.log("Message sent:", !messageSent);
//   } catch (error) {
//     console.error("An error occurred:", error);
//   }
// }

main();
