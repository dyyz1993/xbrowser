import { execSync } from 'child_process';

export interface SMSMessage {
  text: string;
  time: string;
  sender: string;
  code: string | null;
}

const DB_PATH = '/Users/xuyingzhou/Library/Messages/chat.db';
const COPY_PATH = '/tmp/chat_copy.db';

function copyDB(): boolean {
  try {
    execSync(`cp "${DB_PATH}" "${COPY_PATH}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function readSMS(options?: {
  filter?: string;
  limit?: number;
  maxAgeSeconds?: number;
}): SMSMessage[] {
  const limit = options?.limit || 20;
  const filter = options?.filter;

  if (!copyDB()) return [];

  let whereClause = "1=1";
  if (filter) {
    whereClause += ` AND (text LIKE '%${filter}%' OR text LIKE '%验证%' OR text LIKE '%code%' OR text LIKE '%Code%' OR text LIKE '%verif%')`;
  } else {
    whereClause += ` AND (text LIKE '%验证%' OR text LIKE '%verif%' OR text LIKE '%code%' OR text LIKE '%Code%' OR text LIKE '%验证码%')`;
  }

  if (options?.maxAgeSeconds) {
    const cutoff = Date.now() / 1000 - options.maxAgeSeconds;
    const macTimestamp = (cutoff - 978307200) * 1000000000;
    whereClause += ` AND date > ${macTimestamp}`;
  }

  const query = `SELECT text, datetime(date/1000000000 + 978307200, 'unixepoch', 'localtime') as time FROM message WHERE ${whereClause} ORDER BY date DESC LIMIT ${limit}`;

  try {
    const result = execSync(`sqlite3 "${COPY_PATH}" "${query}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [text, time] = line.split('|');
        const codeMatch = text?.match(
          /(?:验证码|code|Code|码)[：:\s]*(\d{4,8})/
        );
        return {
          text: text || '',
          time: time || '',
          sender: '',
          code: codeMatch ? codeMatch[1] : null,
        };
      });
  } catch {
    return [];
  }
}

export function getLatestCode(senderFilter?: string): string | null {
  const messages = readSMS({ limit: 10, maxAgeSeconds: 300 });
  for (const msg of messages) {
    if (
      senderFilter &&
      !msg.text.toLowerCase().includes(senderFilter.toLowerCase())
    )
      continue;
    if (msg.code) return msg.code;
  }
  return null;
}

export function waitForSMSCode(
  senderFilter?: string,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 3000
): Promise<string | null> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      const code = getLatestCode(senderFilter);
      if (code) {
        resolve(code);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(poll, pollIntervalMs);
    };
    poll();
  });
}
