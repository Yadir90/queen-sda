// Declaraciones de tipos para el núcleo del Menú del día
// (menuCore.mjs): taxonomía, catálogo ligero con perfil compartido,
// documento editable con persistencia por día/base, disponibilidad
// e Historial — puerto del MenuTab del SDA original (D-R6-02).
import type { MenuCatalogProduct, MenuDoc, MenuDocState, MenuItem, MenuProductProfile, MenuState, StoredData } from '../types'

export declare const MENU_DEPT_ORDER: string[]
export declare const MENU_FAMILIES: Record<string, string[]>
export declare function canonicalMenuSection(section: string): string
export declare function menuSectionLabel(section: string): string
export declare function menuFamiliesFor(section: string): string[]
export declare function compareMenuItems(a: { section: string; family?: string; name: string }, b: { section: string; family?: string; name: string }): number
export declare function sortMenuItems<T extends { section: string; family?: string; name: string }>(items: T[]): T[]
export interface MenuSectionGroup { section: string; families: Array<{ family: string; items: MenuItem[] }> }
export declare function groupMenuItems(items: MenuItem[]): MenuSectionGroup[]
export declare function productInitials(name: string): string
export declare function fmtMenuDayLong(iso: string): string

export declare const EMPTY_MENU_PROFILE: MenuProductProfile
export declare const EMPTY_MENU_STATE: MenuState
export declare function normalizeMenuState(raw: unknown): MenuState

export interface MenuCatalog {
  products: MenuCatalogProduct[]
  latestDate: string | null
  totalProductos: number
  conExistencia: number
}
export declare function buildMenuCatalog(data: StoredData, profiles?: Record<string, MenuProductProfile>): MenuCatalog

export declare function menuItemPrice(item: { priceText?: string }): number | null
export declare function buildAutoMenuDoc(catalogProducts: MenuCatalogProduct[]): MenuDocState
export declare function resolveMenuDoc(state: MenuState, date: string, catalogProducts: MenuCatalogProduct[]): { doc: MenuDocState; source: 'day' | 'base' | 'generated'; sourceLabel: string }
export declare function menuDocToStored(doc: MenuDocState): MenuDoc

export declare function applySaveMenu(state: MenuState, date: string, scope: 'day' | 'base', editableDoc: MenuDocState): MenuState
export declare function applyResetMenu(state: MenuState, date: string): MenuState
export declare function applyMenuAvailability(state: MenuState, date: string, productKey: string, available: boolean): MenuState
export declare function applyMenuProfile(state: MenuState, productKey: string, patch: Partial<MenuProductProfile>): MenuState

export declare function isMenuItemHidden(item: MenuItem, catalogByKey: Map<string, MenuCatalogProduct>): boolean
export declare function visibleMenuItems(doc: MenuDocState, catalogByKey: Map<string, MenuCatalogProduct>): MenuItem[]
export interface MenuDocData {
  kind: 'menu'
  title: string
  dateLabel: string
  subtitle: string
  footerText: string
  sections: Array<{ section: string; families: Array<{ family: string; items: Array<{ name: string; price: number | null; description: string }> }> }>
  itemCount: number
  excluded: Array<{ name: string; rule: string }>
  signatures: null
}
export declare function buildMenuDocData(doc: MenuDocState, catalogProducts: MenuCatalogProduct[], date: string, fmtDateLabel?: string): MenuDocData

export interface MenuHistoryEntry {
  key: string
  product: MenuCatalogProduct | null
  item: MenuItem | null
  name: string
  section: string
  family: string
  price: number | null
  description: string
  availableToday: boolean
  menuHidden: boolean
  reason: string
}
export declare function menuHistoryCount(doc: MenuDocState | null, catalogProducts: MenuCatalogProduct[]): number
export declare function buildMenuHistory(doc: MenuDocState | null, catalogProducts: MenuCatalogProduct[], search?: string): MenuHistoryEntry[]
