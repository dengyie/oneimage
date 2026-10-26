export interface VerificationMailer {
  sendVerificationCode(to: string, code: string): Promise<void>
}

export interface OneMailMailerConfig {
  apiBase: string
  token: string
  fromName: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function buildCodeEmailHtml(code: string): string {
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#18181b;">',
    '<h2 style="margin:0 0 12px;font-size:18px;">OneImage 邮箱验证</h2>',
    '<p style="margin:0 0 16px;font-size:14px;color:#3f3f46;">您正在注册 OneImage 账号，验证码为：</p>',
    `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;color:#10b981;">${code}</p>`,
    '<p style="margin:0 0 8px;font-size:13px;color:#52525b;">验证码 10 分钟内有效，请勿泄露给他人。</p>',
    '<p style="margin:0;font-size:12px;color:#a1a1aa;">若非本人操作，请忽略本邮件。图片编辑始终可在未登录状态下离线使用。</p>',
    '</div>',
  ].join('\n')
}

// Sender backed by the one-mail external API. The token is the long-lived JWT
// of the dedicated oneimage@otp.mangoqwq.com sender address (see the one-mail
// operations notes); outbound delivery rides the per-domain Resend channel.
export function createOneMailMailer(config: OneMailMailerConfig): VerificationMailer {
  const doFetch = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? 10_000
  return {
    async sendVerificationCode(to: string, code: string): Promise<void> {
      const response = await doFetch(`${config.apiBase}/external/api/send_mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: config.token,
          from_name: config.fromName,
          to_mail: to,
          to_name: '',
          subject: `OneImage 邮箱验证码 ${code}`,
          content: buildCodeEmailHtml(code),
          is_html: true,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`one-mail send failed (${response.status}): ${detail.slice(0, 200)}`)
      }
    },
  }
}
