'use server'
import { logger } from '@/lib/logger'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'

export async function updateSetting(
  key: string,
  value: string,
  _userId: string
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient
      .from('app_settings')
      .select('key, value_json')
      .eq('key', key)
      .single()

    let parsedValue: unknown = value
    try {
      parsedValue = JSON.parse(value)
    } catch {
      // keep as string
    }

    await adminClient.from('app_settings').upsert({
      key,
      value_json: parsedValue,
      updated_by_user_id: user.id,
      updated_at: new Date().toISOString(),
    })

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.APP_SETTING,
      entityId: key,
      action: AuditAction.SETTING_CHANGED,
      oldValues: existing ? { value: existing.value_json } : undefined,
      newValues: { value: parsedValue },
    })

    return {}
  } catch (err) {
    logger.error('updateSetting error:', { error: err })
    return { error: 'Erro ao atualizar configuração' }
  }
}
