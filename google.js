const { google } = require('googleapis');

function getOAuth2Client() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oAuth2Client;
}

/**
 * Get FreeBusy for a calendarId between timeMin and timeMax (ISO strings)
 */
async function getFreeBusy(calendarId, timeMin, timeMax) {
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin, timeMax,
      items: [{ id: calendarId }]
    }
  });
  return res.data;
}

/**
 * Insert an event in calendar
 * eventObj: start: {dateTime}, end: {dateTime}, summary, description, attendees[]
 */
async function createEvent(calendarId, eventObj) {
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.insert({
    calendarId,
    requestBody: eventObj
  });
  return res.data;
}

async function listCalendars() {
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.calendarList.list();
  return res.data;
}

module.exports = { getOAuth2Client, getFreeBusy, createEvent, listCalendars };
