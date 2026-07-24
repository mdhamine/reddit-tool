import nodemailer from "nodemailer";
import { defineEventHandler, readBody, createError } from "h3";

interface SendEmailBody {
  to?: string;
  subject?: string;
  content?: string;
}

export default defineEventHandler(async (event) => {
  const gmailUser = process.env.NUXT_GMAIL_USER;
  const gmailAppPassword = process.env.NUXT_GMAIL_APP_PASSWORD;

  const body = (await readBody<SendEmailBody>(event)) ?? ({} as SendEmailBody);
  const { to, subject, content } = body;

  if (!to || !subject || !content) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields: to, subject, content.",
    });
  }

  if (!gmailUser || !gmailAppPassword) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Gmail credentials are not configured. Set NUXT_GMAIL_USER and NUXT_GMAIL_APP_PASSWORD.",
    });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: gmailUser,
      to,
      subject,
      text: content,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (e: any) {
    console.error("Failed to send email:", e);
    throw createError({
      statusCode: 502,
      statusMessage: e?.message || "Failed to send email via Gmail SMTP.",
    });
  }
});
