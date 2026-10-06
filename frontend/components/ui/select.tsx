"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Drop-in replacement for a native <select>: same props, same <option> children,
 * same onChange(event.target.value) contract. The open list is drawn by us, so it
 * uses the brand type and Graphite surfaces instead of the browser's own menu.
 */

// Radix items cannot have an empty value, so "" (the usual "Any" / "Choose…" option) is mapped.
const EMPTY = "__empty__"
const enc = (v: string) => (v === "" ? EMPTY : v)
const dec = (v: string) => (v === EMPTY ? "" : v)

type OptionData = { value: string; label: string; disabled?: boolean }

function collectOptions(children: React.ReactNode): OptionData[] {
  const out: OptionData[] = []
  const walk = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return
      const props = child.props as { value?: string | number; disabled?: boolean; children?: React.ReactNode }
      if (child.type === React.Fragment) { walk(props.children); return }
      const label = React.Children.toArray(props.children).join("")
      out.push({ value: String(props.value ?? label), label, disabled: props.disabled })
    })
  }
  walk(children)
  return out
}

type SelectProps = {
  id?: string
  value?: string | number
  onChange?: (event: { target: { value: string } }) => void
  disabled?: boolean
  required?: boolean
  className?: string
  children?: React.ReactNode
  "aria-label"?: string
  "aria-invalid"?: boolean | "true" | "false"
}

function Select({ id, value, onChange, disabled, required, className, children, ...aria }: SelectProps) {
  const options = collectOptions(children)
  const current = String(value ?? "")
  const selected = options.find((o) => o.value === current)
  return (
    <SelectPrimitive.Root value={enc(current)} onValueChange={(v) => onChange?.({ target: { value: dec(v) } })} disabled={disabled} required={required}>
      <SelectPrimitive.Trigger id={id} data-slot="select-trigger" className={cn("sel-trigger", className)} {...aria}>
        <span className={cn("sel-value", !current && "sel-placeholder")}>{selected?.label ?? ""}</span>
        <SelectPrimitive.Icon asChild><ChevronDown size={15} aria-hidden="true" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content data-slot="select-content" className="sel-content" position="popper" sideOffset={6} collisionPadding={12}>
          <SelectPrimitive.Viewport className="sel-viewport">
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={enc(o.value)} disabled={o.disabled} className="sel-item">
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="sel-check"><Check size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export { Select }
