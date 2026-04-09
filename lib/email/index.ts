import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.EMAIL_FROM ?? 'MedAxis <noreply@medaxis.com.br>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://med-axis-three.vercel.app'

export { FROM, APP_URL }

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping email:', subject)
    return
  }

  try {
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch (err) {
    // Never throw — email failure must never break the main flow
    console.error('[email] Failed to send:', subject, err)
  }
}
