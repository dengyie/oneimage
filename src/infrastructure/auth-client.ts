export interface SafeUser {
  id: string
  username: string
  email: string
  nickname: string
  avatar_color: string
  created_at: number
  updated_at: number
}

export interface CloudProject {
  id: string
  user_id: string
  title: string
  original_filename: string
  dimensions_width: number
  dimensions_height: number
  thumbnail_data: string
  state_json: string
  created_at: number
  updated_at: number
}

export async function fetchCurrentUser(): Promise<SafeUser | null> {
  try {
    const res = await fetch('/api/v1/auth/me', {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.authenticated && data.user) {
      return data.user as SafeUser
    }
    return null
  } catch {
    return null
  }
}

export async function loginUser(account: string, password: string): Promise<{ ok: boolean; user?: SafeUser; message?: string }> {
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ account, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, message: data.message || '登录失败' }
    }
    return { ok: true, user: data.user }
  } catch (err: any) {
    return { ok: false, message: err?.message || '网络连接失败' }
  }
}

export async function registerUser(
  username: string,
  email: string,
  password: string,
  nickname?: string
): Promise<{ ok: boolean; user?: SafeUser; message?: string }> {
  try {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, email, password, nickname }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, message: data.message || '注册失败' }
    }
    return { ok: true, user: data.user }
  } catch (err: any) {
    return { ok: false, message: err?.message || '网络连接失败' }
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // ignore
  }
}

export async function updateUserProfile(updates: { nickname?: string; avatar_color?: string }): Promise<SafeUser | null> {
  try {
    const res = await fetch('/api/v1/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.user || null
  } catch {
    return null
  }
}

export async function fetchCloudProjects(): Promise<CloudProject[]> {
  try {
    const res = await fetch('/api/v1/projects', {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.projects || []
  } catch {
    return []
  }
}

export async function saveCloudProject(project: {
  id?: string
  title: string
  original_filename: string
  dimensions_width: number
  dimensions_height: number
  thumbnail_data: string
  state_json: string
}): Promise<CloudProject | null> {
  try {
    const res = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(project),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.project || null
  } catch {
    return null
  }
}

export async function deleteCloudProject(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

