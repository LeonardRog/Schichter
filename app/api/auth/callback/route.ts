import { google } from 'googleapis';
import { NextResponse } from 'next/server';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const origin = `${url.protocol}//${url.host}`;

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      return NextResponse.redirect(`${origin}/?error=auth_failed`);
    }

    const response = NextResponse.redirect(`${origin}/?auth=success`);

    response.cookies.set('gtoken', tokens.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    });

    if (tokens.refresh_token) {
      response.cookies.set('grefresh', tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 3600,
        path: '/',
      });
    }

    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }
}
