import Axios from 'axios';
import { getFromLocalStorageWithExpiry, setLocalStorageWithExpiry } from '../localstorage';
import axios from '../../axios';

/* eslint-disable import/no-anonymous-default-export */
const client_id = process.env.REACT_APP_SPOTIFY_CLIENT_ID as string;
const raw_redirect_uri = process.env.REACT_APP_SPOTIFY_REDIRECT_URL as string;
const redirect_uri = raw_redirect_uri.replace(/\/$/, ''); // Consistently remove trailing slash

const authUrl = new URL('https://accounts.spotify.com/authorize');

const SCOPES = [
  'ugc-image-upload',

  // Web Playback SDK: `streaming` only yields a playable device when the account-info
  // scopes are also granted. Without these two the SDK registers a device that Spotify
  // rejects as "Device not found" on playback. They are required, not optional.
  'streaming',
  'user-read-email',
  'user-read-private',

  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',

  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'playlist-read-collaborative',

  'user-follow-modify',
  'user-follow-read',

  'user-read-playback-position',
  'user-top-read',
  'user-read-recently-played',

  'user-library-read',
  'user-library-modify',
] as const;

const sha256 = async (plain: string) => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    if (!window.crypto || !window.crypto.subtle) {
      const msg =
        'CRYPTO ERROR: Your browser is blocking security features.\n\n' +
        '1. Use Chrome or Edge.\n' +
        '2. Use http://localhost:3000 (not the IP address).';
      alert(msg);
      throw new Error(msg);
    }
    return await window.crypto.subtle.digest('SHA-256', data);
  } catch (e) {
    alert('Login System Error: ' + (e as Error).message);
    throw e;
  }
};

const base64encode = (input: ArrayBuffer) => {
  // @ts-ignore
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const generateRandomString = (length: number) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
};

const logInWithSpotify = async () => {
  const codeVerifier = generateRandomString(64);
  localStorage.setItem('code_verifier', codeVerifier);

  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
};

const requestToken = async (code: string) => {
  const existing = inFlightExchanges[code];
  if (existing) return existing;

  const exchange = (async () => {
    const code_verifier = localStorage.getItem('code_verifier');

    if (!code_verifier) {
      throw new Error('Missing code_verifier');
    }

    const body = new URLSearchParams({
      code,
      client_id,
      redirect_uri,
      code_verifier,
      grant_type: 'authorization_code',
    });

    try {
      const { data: response } = await Axios.post<{
        access_token: string;
        token_type: string;
        expires_in: number;
        refresh_token: string;
      }>('https://accounts.spotify.com/api/token', body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (response.access_token) {
        setLocalStorageWithExpiry(
          'access_token',
          response.access_token,
          response.expires_in * 1000
        );
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.access_token;
        localStorage.setItem('refresh_token', response.refresh_token);
        localStorage.removeItem('code_verifier');
      }

      return response.access_token;
    } catch (err: any) {
      throw err;
    }
  })();

  inFlightExchanges[code] = exchange;
  return exchange;
};

const inFlightExchanges: Record<string, Promise<string> | undefined> = {};

const getToken = async () => {
  const token = getFromLocalStorageWithExpiry('access_token');
  if (token) {
    return [token, true];
  }

  const urlParams = new URLSearchParams(window.location.search);
  let code = urlParams.get('code') as string;
  let error = urlParams.get('error') as string;

  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    return [null, false];
  }

  if (code) {
    window.history.replaceState({}, document.title, window.location.pathname);
    try {
      const token = await requestToken(code);
      return [token, true];
    } catch (error) {
      return [null, true];
    }
  }

  return [null, false];
};

export const getRefreshToken = async () => {
  const refreshToken = localStorage.getItem('refresh_token') as string;

  if (!refreshToken) {
    return null;
  }

  const url = 'https://accounts.spotify.com/api/token';

  const payload = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  };
  
  try {
    const body = await fetch(url, payload);
    const response = await body.json();

    if (!response.access_token) {
      return null;
    }

    setLocalStorageWithExpiry('access_token', response.access_token, response.expires_in * 1000);
    axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.access_token;
    if (response.refresh_token) {
      localStorage.setItem('refresh_token', response.refresh_token);
    }
    return response.access_token;
  } catch (error) {
    return null;
  }
};

export default { logInWithSpotify, getToken, getRefreshToken };
