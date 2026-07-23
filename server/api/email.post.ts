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

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: config.gmailUser,
      to: body.to,
      subject: body.subject,
      text: body.content,
      // If you want to allow HTML content instead, swap `text` for `html`.
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
