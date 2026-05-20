import { google } from 'googleapis';
import { NextResponse } from 'next/server';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export async function GET() {
  const oauth2Client = getOAuth2Client();
  console.log('[auth/google] GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent',
  });

  return NextResponse.redirect(authUrl);
}
