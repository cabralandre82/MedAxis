'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Pencil, Check, X, Power, PowerOff, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  createCategory,
  updateCategory,
  toggleCategoryActive,
  reorderCategory,
} from '@/services/categories'
import { slugify } from '@/lib/utils'

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  product_count: number
}

interface CategoriesManagerProps {
  categories: Category[]
}

interface EditState {
  name: string
  description: string
  sort_order: string
}

export function CategoriesManager({ categories: initial }: CategoriesManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // New category form
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSortOrder, setNewSortOrder] = useState('')

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>({
    name: '',
    description: '',
    sort_order: '',
  })

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEditState({
      name: cat.name,
      description: cat.description ?? '',
      sort_order: String(cat.sort_order),
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditState({ name: '', description: '', sort_order: '' })
  }

  function handleAdd() {
    if (!newName.trim()) {
      toast.error('Informe o nome da categoria')
      return
    }
    startTransition(async () => {
      const result = await createCategory({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        sort_order: newSortOrder ? Number(newSortOrder) : undefined,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Categoria criada!')
      setAdding(false)
      setNewName('')
      setNewDescription('')
      setNewSortOrder('')
      router.refresh()
    })
  }

  function handleUpdate(id: string) {
    if (!editState.name.trim()) {
      toast.error('Nome é obrigatório')
      return
    }
    startTransition(async () => {
      const result = await updateCategory(id, {
        name: editState.name.trim(),
        description: editState.description.trim() || undefined,
        sort_order: editState.sort_order ? Number(editState.sort_order) : undefined,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Categoria atualizada!')
      cancelEdit()
      router.refresh()
    })
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      const result = await toggleCategoryActive(id, !current)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(current ? 'Categoria desativada' : 'Categoria ativada')
      router.refresh()
    })
  }

  // Reserved for upcoming drag-and-drop reorder UI; kept here so the server
  // action `reorderCategory` is exercised by typecheck and not tree-shaken.
  function _handleReorder(id: string, value: string) {
    const n = Number(value)
    if (isNaN(n)) return
    startTransition(async () => {
      const result = await reorderCategory(id, n)
      if (result.error) toast.error(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {initial.length} categoria{initial.length !== 1 ? 's' : ''} ·{' '}
          {initial.filter((c) => c.is_active).length} ativa
          {initial.filter((c) => c.is_active).length !== 1 ? 's' : ''}
        </p>
        {!adding && (
          <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Nova categoria
          </Button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="mb-3 text-sm font-semibold text-blue-800">Nova categoria</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="new-category-name" className="mb-1 block text-xs text-slate-600">
                Nome *
              </Label>
              <Input
                id="new-category-name"
                autoFocus
                placeholder="Ex: Hormônios, Vitaminas, Analgésicos..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
              {newName && (
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  slug: {slugify(newName)}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="new-category-order" className="mb-1 block text-xs text-slate-600">
                Ordem de exibição
              </Label>
              <Input
                id="new-category-order"
                type="number"
                min="0"
                placeholder="0"
                value={newSortOrder}
                onChange={(e) => setNewSortOrder(e.target.value)}
              />
            </div>
            <div className="sm:col-span-3">
              <Label
                htmlFor="new-category-description"
                className="mb-1 block text-xs text-slate-600"
              >
                Descrição (opcional)
              </Label>
              <Input
                id="new-category-description"
                placeholder="Breve descrição para uso interno..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={isPending} className="gap-1.5">
              <Check className="h-3.5 w-3.5" />
              Salvar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(false)
                setNewName('')
                setNewDescription('')
                setNewSortOrder('')
              }}
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Categorias cadastradas com ordem, descrição, contagem de produtos, status e ações de
            edição
          </caption>
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
              <th scope="col" className="w-10 px-3 py-3 text-center">
                Ord.
              </th>
              <th scope="col" className="px-4 py-3">
                Nome / Slug
              </th>
              <th scope="col" className="hidden px-4 py-3 sm:table-cell">
                Descrição
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                Produtos
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {initial.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-slate-400">
                  Nenhuma categoria cadastrada. Crie a primeira clicando em &quot;Nova
                  categoria&quot;.
                </td>
              </tr>
            )}
            {initial.map((cat) => {
              const isEditing = editingId === cat.id
              return (
                <tr
                  key={cat.id}
                  className={`transition-colors ${!cat.is_active ? 'opacity-50' : 'hover:bg-slate-50/50'}`}
                >
                  {/* Sort order */}
                  <td className="px-3 py-3 text-center">
                    {isEditing ? (
                      <Input
                        type="number"
                        min="0"
                        value={editState.sort_order}
                        onChange={(e) =>
                          setEditState((s) => ({ ...s, sort_order: e.target.value }))
                        }
                        className="h-7 w-14 text-center text-xs"
                      />
                    ) : (
                      <span className="flex items-center justify-center gap-1 text-xs text-slate-400">
                        <GripVertical className="h-3.5 w-3.5" />
                        {cat.sort_order}
                      </span>
                    )}
                  </td>

                  {/* Name / slug */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div>
                        <Input
                          value={editState.name}
                          onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                          className="h-8 text-sm"
                          autoFocus
                        />
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          slug: {slugify(editState.name)}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <span className="font-medium text-slate-900">{cat.name}</span>
                        <p className="font-mono text-[11px] text-slate-400">{cat.slug}</p>
                      </div>
                    )}
                  </td>

                  {/* Description */}
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {isEditing ? (
                      <Input
                        value={editState.description}
                        onChange={(e) =>
                          setEditState((s) => ({ ...s, description: e.target.value }))
                        }
                        placeholder="Descrição opcional..."
                        className="h-8 text-sm"
                      />
                    ) : (
                      <span className="text-slate-500">{cat.description ?? '—'}</span>
                    )}
                  </td>

                  {/* Product count */}
                  <td className="px-4 py-3 text-center">
                    <Badge
                      className={`text-xs ${cat.product_count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}
                    >
                      {cat.product_count}
                    </Badge>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    <Badge
                      className={`text-xs ${cat.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                    >
                      {cat.is_active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => handleUpdate(cat.id)}
                          disabled={isPending}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={cancelEdit}
                          disabled={isPending}
                          aria-label="Cancelar edição"
                          title="Cancelar edição"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                          onClick={() => startEdit(cat)}
                          aria-label={`Editar categoria ${cat.name}`}
                          title="Editar"
                          disabled={isPending}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-7 w-7 p-0 ${cat.is_active ? 'text-slate-400 hover:text-red-500' : 'text-slate-400 hover:text-green-600'}`}
                          onClick={() => handleToggle(cat.id, cat.is_active)}
                          aria-label={
                            cat.is_active
                              ? `Desativar categoria ${cat.name}`
                              : `Ativar categoria ${cat.name}`
                          }
                          title={cat.is_active ? 'Desativar' : 'Ativar'}
                          disabled={
                            isPending ||
                            (cat.product_count > 0 && (cat.is_active === false) === false)
                          }
                        >
                          {cat.is_active ? (
                            <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Power className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        💡 A ordem de exibição controla a sequência no catálogo e no formulário de novo produto.
        Clique no lápis para editar nome, descrição e ordem de qualquer categoria.
      </p>
    </div>
  )
}
