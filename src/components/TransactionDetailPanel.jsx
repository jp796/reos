"use client";

/**
 * TransactionDetailPanel — REOS transaction detail UI.
 *
 * Three tabs: Details · Contacts · Milestones.
 * Auto-saves every change after a 900ms debounce. No save button.
 *
 * Self-contained: all styling inline so the file can drop into any
 * React 17+/Next.js client tree with no Tailwind / CSS-module setup.
 * Renders into the surrounding page width (max 880 wide, centered).
 *
 * Props:
 *   transaction (object, optional) — see DEFAULT_TRANSACTION below
 *                                   for the shape.
 *   onSave (async fn) — receives the full updated transaction
 *                       object every time the debounce fires.
 *
 * Usage:
 *   <TransactionDetailPanel
 *     transaction={currentTransaction}
 *     onSave={async (updated) => await api.saveTransaction(updated)}
 *   />
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────────
 * Theme tokens — every spec'd color lives here so re-skinning is a
 * one-place edit. NO Tailwind, no CSS variables, no stylesheets.
 * ───────────────────────────────────────────────────────────────── */
const C = {
  purple: "#534AB7",
  purpleSoft: "#EEEDFE",
  purpleBorder: "#AFA9EC",
  purpleText: "#3C3489",
  purpleFocus: "#7F77DD",
  borderCard: "#E0DEFA",
  borderInput: "#ddd",
  divider: "#F0EFFE",
  labelText: "#888",
  bodyText: "#222",
  bodySoft: "#444",
  // pill swatches
  pillPurple: { bg: "#EEEDFE", text: "#3C3489", border: "#AFA9EC" },
  pillBlue: { bg: "#E6F1FB", text: "#0C447C", border: "#85B7EB" },
  pillAmber: { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  pillGreen: { bg: "#EAF3DE", text: "#27500A", border: "#97C459" },
  pillRed: { bg: "#FCEBEB", text: "#791F1F", border: "#F09595" },
  pillGray: { bg: "#F1EFE8", text: "#444441", border: "#B4B2A9" },
  // overdue / missing state
  badBg: "#FFF8F8",
  badBorder: "#F09595",
  badText: "#791F1F",
  // save indicator
  saving: "#888",
  saved: "#27500A",
  error: "#791F1F",
};

const F = {
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

/* ─────────────────────────────────────────────────────────────────
 * Defaults — used when no `transaction` prop is passed.
 * ───────────────────────────────────────────────────────────────── */
const DEFAULT_TRANSACTION = {
  address: "3327 Thomas Rd",
  city: "Cheyenne",
  state: "WY",
  status: "active",
  side: "Buyer",
  price: 450000,
  source: "Zillow",
  commissionPct: 2.5,
  contractDate: "2026-04-01",
  expirationDate: "",
  closingDate: "2026-06-16",
  underContractDate: "2026-04-23",
  earnestMoney: 5000,
  earnestDueDate: "2026-04-05",
  inspectionDeadline: "2026-05-20",
  inspectionObjDeadline: "2026-05-22",
  financingDeadline: "2026-04-23",
  notes: "",
  contacts: [
    {
      id: "c1",
      role: "Buyer",
      firstName: "John",
      lastName: "Hamilton",
      brokerage: "",
      emails: ["john.hamilton@email.com"],
      phones: ["(307) 555-0101"],
      additionalNames: [],
    },
    {
      id: "c2",
      role: "Buyer Agent",
      firstName: "Dave",
      lastName: "Drahn",
      brokerage: "Colorado Real Estate Brokers",
      emails: ["dave@coloradore.com"],
      phones: ["(720) 555-0200"],
      additionalNames: [],
    },
    {
      id: "c3",
      role: "Lender",
      firstName: "Freedom",
      lastName: "Mortgage",
      brokerage: "Freedom Mortgage",
      emails: ["tc@freedommortgage.com"],
      phones: ["(800) 555-0300"],
      additionalNames: [],
    },
  ],
};

const STATUS_OPTIONS = ["active", "listing", "closed", "terminated"];
const SIDE_OPTIONS = ["Buyer", "Seller", "Dual"];
const ROLE_OPTIONS = [
  "Buyer",
  "Seller",
  "Buyer Agent",
  "Seller Agent",
  "TC",
  "Lender",
  "Title",
  "Other",
];

const ROLE_PILL_COLOR = {
  Buyer: C.pillGreen,
  Seller: C.pillAmber,
  "Buyer Agent": C.pillBlue,
  "Seller Agent": C.pillPurple,
  TC: C.pillPurple,
  Lender: C.pillGray,
  Title: C.pillGray,
  Other: C.pillGray,
};

/* ─────────────────────────────────────────────────────────────────
 * Reusable styled primitives.
 * ───────────────────────────────────────────────────────────────── */
function Pill({ color = C.pillGray, children, style }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: color.bg,
        color: color.text,
        border: `0.5px solid ${color.border}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function MissingBadge() {
  return <Pill color={C.pillRed}>MISSING</Pill>;
}
function OverdueBadge() {
  return <Pill color={C.pillRed}>OVERDUE</Pill>;
}

function SectionLabel({ children, first }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: C.labelText,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
        marginTop: first ? 0 : 22,
        marginBottom: 12,
        paddingTop: first ? 0 : 14,
        borderTop: first ? "none" : `0.5px solid ${C.divider}`,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children, bad }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: bad ? C.badText : C.labelText,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 500,
        marginBottom: 6,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </div>
  );
}

function inputStyle({ bad, focused }) {
  return {
    width: "100%",
    boxSizing: "border-box",
    border: `0.5px solid ${
      focused ? C.purpleFocus : bad ? C.badBorder : C.borderInput
    }`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: F.fontFamily,
    color: C.bodyText,
    background: bad ? C.badBg : "#fff",
    outline: "none",
  };
}

function TextField({ value, onChange, type = "text", bad, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={inputStyle({ bad, focused })}
      {...rest}
    />
  );
}

function NumberField({ value, onChange, bad, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="number"
      value={value === null || value === undefined ? "" : value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : Number(v));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={inputStyle({ bad, focused })}
      {...rest}
    />
  );
}

function SelectField({ value, onChange, options, bad, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...inputStyle({ bad, focused }),
        appearance: "none",
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'><path fill='%23888' d='M6 8L0 0h12z'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        backgroundSize: "10px",
        paddingRight: 28,
      }}
      {...rest}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function TextArea({ value, onChange, rows = 4, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      value={value ?? ""}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...inputStyle({ focused }),
        resize: "vertical",
        minHeight: 80,
        lineHeight: 1.45,
      }}
      {...rest}
    />
  );
}

function PrimaryButton({ children, ...rest }) {
  return (
    <button
      type="button"
      style={{
        background: C.purple,
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "7px 14px",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: F.fontFamily,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, ...rest }) {
  return (
    <button
      type="button"
      style={{
        background: "transparent",
        color: C.purple,
        border: `0.5px solid ${C.purpleBorder}`,
        borderRadius: 8,
        padding: "5px 10px",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: F.fontFamily,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function IconBtn({ children, label, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: C.labelText,
        fontSize: 16,
        padding: 4,
        lineHeight: 1,
        fontFamily: F.fontFamily,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Auto-save indicator. Cycles dirty → saving → saved (fade) → idle.
 * ───────────────────────────────────────────────────────────────── */
function SaveBadge({ status }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (status === "saved") {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 1200);
      return () => clearTimeout(t);
    }
    setVisible(true);
  }, [status]);

  if (status === "idle") return null;
  if (status === "saved" && !visible) return null;

  let text = "";
  let color = C.labelText;
  if (status === "dirty" || status === "saving") {
    text = "Saving…";
    color = C.saving;
  } else if (status === "saved") {
    text = "Saved ✓";
    color = C.saved;
  } else if (status === "error") {
    text = "Couldn't save — retrying";
    color = C.error;
  }
  return (
    <span
      style={{
        fontSize: 12,
        color,
        opacity: status === "saved" && !visible ? 0 : 1,
        transition: "opacity 0.4s ease",
      }}
    >
      {text}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Debounced auto-save hook.
 * Returns [current value, patch fn, status].
 * onSave is called with the full merged object after 900ms idle.
 * ───────────────────────────────────────────────────────────────── */
function useAutoSave(initial, onSave) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState("idle");
  const timerRef = useRef(null);
  const latestRef = useRef(value);

  // keep the "what to save" reference current
  latestRef.current = value;

  // If parent passes a new transaction prop (e.g. after a server roundtrip), accept it
  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const patch = (partial) => {
    setValue((prev) => {
      const next =
        typeof partial === "function" ? partial(prev) : { ...prev, ...partial };
      latestRef.current = next;
      return next;
    });
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        if (typeof onSave === "function") {
          await onSave(latestRef.current);
        }
        setStatus("saved");
      } catch (err) {
        setStatus("error");
        // eslint-disable-next-line no-console
        console.warn("[TransactionDetailPanel] save failed:", err);
      }
    }, 900);
  };

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return [value, patch, status];
}

/* ═════════════════════════════════════════════════════════════════
 * TAB 1 — DETAILS
 * ═════════════════════════════════════════════════════════════════ */
function DetailsTab({ t, patch }) {
  const gci = useMemo(() => {
    const p = Number(t.price) || 0;
    const c = Number(t.commissionPct) || 0;
    return (p * c) / 100;
  }, [t.price, t.commissionPct]);

  const expirationMissing = !t.expirationDate;

  return (
    <div>
      <SectionLabel first>Status & Representation</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label>Status</Label>
          <SelectField
            value={t.status}
            onChange={(v) => patch({ status: v })}
            options={STATUS_OPTIONS}
          />
        </div>
        <div>
          <Label>Representing / Side</Label>
          <SelectField
            value={t.side}
            onChange={(v) => patch({ side: v })}
            options={SIDE_OPTIONS}
          />
        </div>
      </div>

      <SectionLabel>Property</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px", gap: 12 }}>
        <div>
          <Label>Street address</Label>
          <TextField value={t.address} onChange={(v) => patch({ address: v })} />
        </div>
        <div>
          <Label>City</Label>
          <TextField value={t.city} onChange={(v) => patch({ city: v })} />
        </div>
        <div>
          <Label>State</Label>
          <TextField
            value={t.state}
            onChange={(v) => patch({ state: v.toUpperCase().slice(0, 2) })}
            maxLength={2}
          />
        </div>
      </div>

      <SectionLabel>Financials</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <Label>Sale price ($)</Label>
          <NumberField value={t.price} onChange={(v) => patch({ price: v })} />
        </div>
        <div>
          <Label>Commission %</Label>
          <NumberField
            value={t.commissionPct}
            onChange={(v) => patch({ commissionPct: v })}
            step="0.01"
          />
        </div>
        <div>
          <Label>Est. GCI</Label>
          <div
            style={{
              padding: "7px 10px",
              fontSize: 13,
              border: `0.5px dashed ${C.borderInput}`,
              borderRadius: 8,
              color: C.bodySoft,
              background: "#fafafa",
            }}
          >
            ${gci.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Label>Source / Lead</Label>
        <TextField value={t.source} onChange={(v) => patch({ source: v })} />
      </div>

      <SectionLabel>Contract dates</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label>Contract date</Label>
          <TextField
            type="date"
            value={t.contractDate}
            onChange={(v) => patch({ contractDate: v })}
          />
        </div>
        <div>
          <Label bad={expirationMissing}>
            Contract expiration date {expirationMissing && <MissingBadge />}
          </Label>
          <TextField
            type="date"
            value={t.expirationDate}
            onChange={(v) => patch({ expirationDate: v })}
            bad={expirationMissing}
          />
          {expirationMissing && (
            <div
              style={{
                fontSize: 11,
                color: C.badText,
                marginTop: 6,
                fontStyle: "italic",
              }}
            >
              Not extracted from contract — enter manually.
            </div>
          )}
        </div>
        <div>
          <Label>Under contract date</Label>
          <TextField
            type="date"
            value={t.underContractDate}
            onChange={(v) => patch({ underContractDate: v })}
          />
        </div>
        <div>
          <Label>Est. closing date</Label>
          <TextField
            type="date"
            value={t.closingDate}
            onChange={(v) => patch({ closingDate: v })}
          />
        </div>
      </div>

      <SectionLabel>Earnest money</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label>Earnest money amount ($)</Label>
          <NumberField
            value={t.earnestMoney}
            onChange={(v) => patch({ earnestMoney: v })}
          />
        </div>
        <div>
          <Label>EM due date</Label>
          <TextField
            type="date"
            value={t.earnestDueDate}
            onChange={(v) => patch({ earnestDueDate: v })}
          />
        </div>
      </div>

      <SectionLabel>Notes</SectionLabel>
      <TextArea
        value={t.notes}
        onChange={(v) => patch({ notes: v })}
        placeholder="Anything the next person on this file needs to know…"
      />
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════
 * TAB 2 — CONTACTS
 * ═════════════════════════════════════════════════════════════════ */
function ContactsTab({ t, patch }) {
  const [openId, setOpenId] = useState(() => t.contacts?.[0]?.id ?? null);

  const updateContact = (id, partial) => {
    patch((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c) =>
        c.id === id ? { ...c, ...partial } : c,
      ),
    }));
  };

  const addContact = () => {
    const newId = "c" + Math.random().toString(36).slice(2, 8);
    patch((prev) => ({
      ...prev,
      contacts: [
        ...prev.contacts,
        {
          id: newId,
          role: "Other",
          firstName: "",
          lastName: "",
          brokerage: "",
          emails: [""],
          phones: [""],
          additionalNames: [],
        },
      ],
    }));
    setOpenId(newId);
  };

  const removeContact = (id) => {
    patch((prev) => ({
      ...prev,
      contacts: prev.contacts.filter((c) => c.id !== id),
    }));
  };

  return (
    <div>
      <div
        style={{
          background: C.purpleSoft,
          border: `0.5px solid ${C.purpleBorder}`,
          color: C.purpleText,
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        <strong>Buyer / Seller</strong> = the actual party.{" "}
        <strong>Buyer Agent / Seller Agent</strong> = their representative broker — e.g.
        Dave Drahn at Colorado Real Estate Brokers is a <em>Buyer Agent</em>, not the Buyer.{" "}
        <strong>TC</strong> = Transaction Coordinator.{" "}
        <strong>Lender</strong> = mortgage contact.
      </div>

      {t.contacts.map((c, idx) => (
        <ContactCard
          key={c.id}
          contact={c}
          open={openId === c.id}
          onToggle={() => setOpenId((cur) => (cur === c.id ? null : c.id))}
          onChange={(patchPartial) => updateContact(c.id, patchPartial)}
          onRemove={idx === 0 ? null : () => removeContact(c.id)}
        />
      ))}

      <div style={{ marginTop: 12 }}>
        <GhostButton onClick={addContact}>+ Add contact</GhostButton>
      </div>
    </div>
  );
}

function ContactCard({ contact, open, onToggle, onChange, onRemove }) {
  const initials = (
    (contact.firstName?.[0] ?? "") + (contact.lastName?.[0] ?? "")
  )
    .toUpperCase()
    .slice(0, 2) || "?";

  const isAgent =
    contact.role === "Buyer Agent" || contact.role === "Seller Agent";

  return (
    <div
      style={{
        background: "#fff",
        border: `0.5px solid ${C.borderCard}`,
        borderRadius: 12,
        marginBottom: 10,
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            background: C.purpleSoft,
            color: C.purpleText,
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: C.bodyText }}>
              {contact.firstName || contact.lastName
                ? `${contact.firstName} ${contact.lastName}`.trim()
                : "Unnamed contact"}
            </span>
            <Pill color={ROLE_PILL_COLOR[contact.role] ?? C.pillGray}>
              {contact.role}
            </Pill>
          </div>
          {contact.brokerage && (
            <div style={{ fontSize: 11, color: C.labelText, marginTop: 2 }}>
              {contact.brokerage}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onRemove && (
            <IconBtn
              label="Remove contact"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              ×
            </IconBtn>
          )}
          <span style={{ color: C.labelText, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: `0.5px solid ${C.divider}` }}>
          <div style={{ height: 12 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
            }}
          >
            <div>
              <Label>Role</Label>
              <SelectField
                value={contact.role}
                onChange={(v) => onChange({ role: v })}
                options={ROLE_OPTIONS}
              />
            </div>
            <div>
              <Label>First name</Label>
              <TextField
                value={contact.firstName}
                onChange={(v) => onChange({ firstName: v })}
              />
            </div>
            <div>
              <Label>Last name</Label>
              <TextField
                value={contact.lastName}
                onChange={(v) => onChange({ lastName: v })}
              />
            </div>
          </div>

          {isAgent && (
            <div
              style={{
                fontSize: 11,
                color: C.labelText,
                fontStyle: "italic",
                marginTop: 8,
              }}
            >
              This person represents the {contact.role === "Buyer Agent" ? "buyer" : "seller"}{" "}
              — not the party.
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <Label>Brokerage / Company</Label>
            <TextField
              value={contact.brokerage}
              onChange={(v) => onChange({ brokerage: v })}
              placeholder="e.g. Colorado Real Estate Brokers"
            />
          </div>

          <MultiValueField
            label="Emails"
            values={contact.emails ?? []}
            onChange={(arr) => onChange({ emails: arr })}
            placeholder="name@brokerage.com"
            type="email"
          />
          <MultiValueField
            label="Phones"
            values={contact.phones ?? []}
            onChange={(arr) => onChange({ phones: arr })}
            placeholder="(555) 555-0000"
            type="tel"
          />
          <MultiValueField
            label="Additional names / aliases"
            values={contact.additionalNames ?? []}
            onChange={(arr) => onChange({ additionalNames: arr })}
            placeholder="Maiden name, nickname, etc."
          />
        </div>
      )}
    </div>
  );
}

function MultiValueField({ label, values, onChange, placeholder, type = "text" }) {
  const safe = Array.isArray(values) ? values : [];
  const setAt = (i, v) => {
    const next = [...safe];
    next[i] = v;
    onChange(next);
  };
  const remove = (i) => onChange(safe.filter((_, j) => j !== i));
  const add = () => onChange([...safe, ""]);

  return (
    <div style={{ marginTop: 14 }}>
      <Label>{label}</Label>
      {safe.length === 0 && (
        <div style={{ fontSize: 11, color: C.labelText, marginBottom: 6 }}>
          None on file.
        </div>
      )}
      {safe.map((v, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}
        >
          <TextField
            type={type}
            value={v}
            onChange={(val) => setAt(i, val)}
            placeholder={placeholder}
          />
          <IconBtn label="Remove" onClick={() => remove(i)}>
            ×
          </IconBtn>
        </div>
      ))}
      <GhostButton onClick={add} style={{ marginTop: 4 }}>
        + Add
      </GhostButton>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════
 * TAB 3 — MILESTONES
 * ═════════════════════════════════════════════════════════════════ */
function MilestonesTab({ t, patch }) {
  const ROWS = [
    { key: "financingDeadline", label: "Financing approval deadline" },
    { key: "inspectionDeadline", label: "Inspection deadline" },
    { key: "inspectionObjDeadline", label: "Inspection objection deadline" },
    { key: "earnestDueDate", label: "Earnest money due" },
    { key: "expirationDate", label: "Contract expiration" },
    { key: "closingDate", label: "Closing date" },
  ];

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {ROWS.map((r) => {
        const value = t[r.key] ?? "";
        const missing = !value;
        const overdue = !missing && value < todayStr;
        const bad = missing || overdue;
        return (
          <div
            key={r.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              marginBottom: 8,
              borderRadius: 10,
              border: `0.5px solid ${bad ? C.badBorder : C.borderCard}`,
              background: bad ? C.badBg : "#fff",
            }}
          >
            <div style={{ flex: 1, fontSize: 13, color: bad ? C.badText : C.bodyText }}>
              {r.label}
            </div>
            <div style={{ width: 180 }}>
              <TextField
                type="date"
                value={value}
                onChange={(v) => patch({ [r.key]: v })}
                bad={bad}
              />
            </div>
            <div style={{ width: 90, textAlign: "right" }}>
              {missing ? (
                <MissingBadge />
              ) : overdue ? (
                <OverdueBadge />
              ) : (
                <Pill color={C.pillGreen}>OK</Pill>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════
 * Top-level panel.
 * ═════════════════════════════════════════════════════════════════ */
const TABS = [
  { key: "details", label: "Details" },
  { key: "contacts", label: "Contacts" },
  { key: "milestones", label: "Milestones" },
];

export default function TransactionDetailPanel({ transaction, onSave }) {
  const initial = useMemo(
    () => ({ ...DEFAULT_TRANSACTION, ...(transaction ?? {}) }),
    [transaction],
  );

  const [t, patch, status] = useAutoSave(initial, onSave);
  const [tab, setTab] = useState("details");

  const headerTitle =
    [t.address, t.city, t.state].filter(Boolean).join(", ") || "New transaction";

  return (
    <div
      style={{
        fontFamily: F.fontFamily,
        color: C.bodyText,
        maxWidth: 880,
        margin: "0 auto",
        padding: 24,
      }}
    >
      {/* Card shell */}
      <div
        style={{
          background: "#fff",
          border: `0.5px solid ${C.borderCard}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 8,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: C.labelText,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 500,
              }}
            >
              Transaction
            </div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 600,
                margin: "4px 0 0",
                color: C.bodyText,
                lineHeight: 1.2,
              }}
            >
              {headerTitle}
            </h1>
          </div>
          <div style={{ minHeight: 18, display: "flex", alignItems: "center" }}>
            <SaveBadge status={status} />
          </div>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 24,
            borderBottom: `0.5px solid ${C.borderCard}`,
            marginTop: 18,
            marginBottom: 20,
          }}
        >
          {TABS.map((tdef) => {
            const active = tab === tdef.key;
            return (
              <button
                key={tdef.key}
                type="button"
                onClick={() => setTab(tdef.key)}
                style={{
                  padding: "10px 2px",
                  cursor: "pointer",
                  color: active ? C.purple : C.labelText,
                  fontSize: 14,
                  fontWeight: 500,
                  background: "none",
                  border: "none",
                  borderBottom: active
                    ? `2px solid ${C.purple}`
                    : "2px solid transparent",
                  marginBottom: -1,
                  fontFamily: F.fontFamily,
                }}
              >
                {tdef.label}
              </button>
            );
          })}
        </div>

        {tab === "details" && <DetailsTab t={t} patch={patch} />}
        {tab === "contacts" && <ContactsTab t={t} patch={patch} />}
        {tab === "milestones" && <MilestonesTab t={t} patch={patch} />}
      </div>
    </div>
  );
}

/* Named export for the defaults too, in case the host page wants to
 * spread them into its own controlled object. */
export { DEFAULT_TRANSACTION };
