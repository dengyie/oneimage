import type Fastify from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { VerificationMailer } from '../server/onemail'

export interface FakeMailer extends VerificationMailer {
  outbox: { to: string; code: string }[]
}

export function createFakeMailer(): FakeMailer {
  const outbox: { to: string; code: string }[] = []
  return {
    outbox,
    async sendVerificationCode(to: string, code: string): Promise<void> {
      outbox.push({ to, code })
    },
  }
}

// Full registration flow through the verification endpoint: request a code,
// read it from the fake mailer outbox, then register. Returns the raw response
// of the register call.
export async function registerViaEmailCode(
  app: ReturnType<typeof Fastify>,
  db: DatabaseSync,
  mailer: FakeMailer,
  params: { username: string; email: string; password: string; nickname?: string; emailCode?: string }
): Promise<Awaited<ReturnType<typeof app.inject>>> {
  if (params.emailCode === undefined) {
    const sendRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email-code',
      payload: { email: params.email },
    })
    if (sendRes.statusCode !== 200) return sendRes
  }
  const sent = mailer.outbox.filter((entry) => entry.to === params.email.trim().toLowerCase()).at(-1)
  const code = params.emailCode ?? sent?.code
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: params.username,
      email: params.email,
      password: params.password,
      nickname: params.nickname,
      email_code: code,
    },
  })
}

// Register/login no longer echo the session token in the JSON body; the token
// rides the HttpOnly cookie only. Tests read it back from the response cookie.
export function sessionTokenFrom(res: { cookies: { name: string; value: string }[] }): string {
  const cookie = res.cookies.find((entry) => entry.name === 'oneimage_session')
  if (!cookie) throw new Error('no oneimage_session cookie on response')
  return cookie.value
}
