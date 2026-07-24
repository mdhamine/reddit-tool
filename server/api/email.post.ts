import nodemailer from "nodemailer";

interface SendEmailBody {
  to: string;
  subject: string;
  content: string;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SendEmailBody>(event);

  if (!body?.to || !body?.subject || !body?.content) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields: to, subject, content",
    });
  }

  const config = useRuntimeConfig();
  const gmailUser = config.gmailUser?.trim(); // must equal mdaksel011@gmail.com
  const gmailPass = config.gmailAppPassword?.trim();

  if (!gmailUser || !gmailPass) {
    console.error(
      "gmailUser:",
      JSON.stringify(gmailUser),
      "passLength:",
      gmailPass?.length,
    );
    throw createError({
      statusCode: 500,
      statusMessage:
        "Email service not configured: NUXT_GMAIL_USER or NUXT_GMAIL_APP_PASSWORD missing/empty",
    });
  }

  console.log("DEBUG gmailUser:", JSON.stringify(gmailUser));
  console.log(
    "DEBUG passLength:",
    gmailPass?.length,
    "first2:",
    gmailPass?.slice(0, 2),
    "last2:",
    gmailPass?.slice(-2),
  );

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `mdaksel011@gmail.com`, // sender shown to recipient
      to: body.to,
      subject: body.subject,
      text: body.content,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err: any) {
    console.error("Failed to send email:", err);
    throw createError({
      statusCode: 500,
      statusMessage: err?.message || "Failed to send email",
    });
  }
});
