export interface AuthUser {
  id: string
  username: string
  display_name: string
  is_active: boolean
  must_change_password: boolean
  created_at: string
}

export interface PayrollMember {
  id: string
  name: string
  hourly_rate_cents: number
}

export interface PayrollDay {
  work_date: string
  status: 'worked' | 'leave'
  hours_hundredths: number
  hourly_rate_cents: number
  amount_cents: number
}

export interface PayrollCalendar {
  member: PayrollMember
  month: string
  today: string
  days: PayrollDay[]
  summary: {
    amount_cents: number
    hours_hundredths: number
    worked_days: number
    leave_days: number
  }
}

export interface DictItem {
  id: string
  name: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_amount_cents: number
}
