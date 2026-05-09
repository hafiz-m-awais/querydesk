"""
backend/email_utils.py
Thin async wrapper around aiosmtplib for sending transactional emails.
"""
import ssl

import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from backend.config import get_settings


async def _send(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user,
        password=settings.smtp_password,
        use_tls=True,
    )


async def send_otp_email(to: str, code: str) -> None:
    settings = get_settings()
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#1d4ed8">QueryDesk — Your verification code</h2>
      <p>Use the code below to check your query status. It expires in
         <strong>{settings.otp_ttl_minutes} minutes</strong>.</p>
      <p style="font-size:2rem;letter-spacing:.4rem;font-weight:bold;color:#1d4ed8">{code}</p>
      <p style="color:#6b7280;font-size:.85rem">
        If you did not request this code, you can safely ignore this email.
      </p>
    </div>
    """
    await _send(to, "QueryDesk — Verify your identity", html)


async def send_status_update_email(
    to: str,
    student_name: str,
    query_subject: str,
    new_status: str,
    instructor_note: str | None,
) -> None:
    status_label = new_status.replace("_", " ").title()
    note_block = (
        f"<p><strong>Instructor note:</strong> {instructor_note}</p>"
        if instructor_note
        else ""
    )
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#1d4ed8">QueryDesk — Query Update</h2>
      <p>Hi {student_name},</p>
      <p>Your query <strong>"{query_subject}"</strong> has been updated.</p>
      <p>New status: <strong style="color:#1d4ed8">{status_label}</strong></p>
      {note_block}
      <p style="color:#6b7280;font-size:.85rem">
        Reply to this email if you have further questions.
      </p>
    </div>
    """
    await _send(to, f"QueryDesk — Your query status: {status_label}", html)
