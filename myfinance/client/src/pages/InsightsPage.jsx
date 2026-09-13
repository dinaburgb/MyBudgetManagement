import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import { Lightbulb, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'
import { useCategories } from '../CategoriesContext.jsx'

/*
 * Insights page — seven monthly-level readings of the family's finances,
 * computed on the server (db/insights.js) over the last N COMPLETE months.
 * This file only turns the numbers and verdict codes into Hebrew sentences.
 */

const HE_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']
const HE_LONG  = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const monthShort = key => { const [y, m] = key.split('-'); return `${HE_SHORT[+m - 1]} ${y.slice(2)}` }
const monthLong  = key => { const [y, m] = key.split('-'); return `${HE_LONG[+m - 1]} ${y}` }
const monthName  = key => HE_LONG[+key.split('-')[1] - 1]
const pct = (x, digits = 0) => x == null ? '—' : `${(x * 100).toFixed(digits)}%`
const signed = n => (n >= 0 ? '+' : '−') + ils(Math.abs(n))
const n1 = n => (Math.round(n * 10) / 10).toLocaleString('he-IL')

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

const TONES = {
  green: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
  red:   'text-red-300 bg-red-500/15 border-red-500/30',
  amber: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  blue:  'text-blue-300 bg-blue-500/15 border-blue-500/30',
  gray:  'text-gray-300 bg-gray-700/40 border-gray-600/40',
}

function Chip({ tone = 'gray', children }) {
  return <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${TONES[tone]}`}>{children}</span>
}

function Card({ n, title, verdict, tone, headline, children, note }) {
  return (
    <section className="bg-gray-900 rounded-xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-300 flex items-center justify-center font-bold shrink-0">{n}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-white font-semibold text-base">{title}</h3>
            {verdict && <Chip tone={tone}>{verdict}</Chip>}
          </div>
          {headline && <p className="text-gray-200 text-sm mt-1 leading-relaxed">{headline}</p>}
        </div>
      </div>
      {children}
      {note && <p className="text-xs text-gray-500 mt-3 leading-relaxed">{note}</p>}
    </section>
  )
}

function Stat({ label, value, tone = 'text-white', sub }) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-3 py-2">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`font-mono font-bold ${tone}`}>{value}</div>
      {sub && <div className="text-gray-500 text-[11px] mt-0.5">{sub}</div>}
    </div>
  )
}

/** Horizontal share bar (0..1) in the category's colour. */
function ShareBar({ value, color }) {
  return (
    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, value * 100))}%`, background: color }} />
    </div>
  )
}

function Details({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function Empty({ children }) {
  return <div className="text-sm text-gray-500 bg-gray-800/40 rounded-lg px-3 py-3">{children}</div>
}

function ChartTip({ active, payload, label, fmt = ils }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-xl">
      <div className="text-gray-300 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-white">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color || p.payload.fill }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-mono">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

const CatDot = ({ name }) => {
  const { colorFor } = useCategories()
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(name) }} />
}

// ---------------------------------------------------------------------------
// 1. Representative month
// ---------------------------------------------------------------------------

function RepresentativeCard({ r, window }) {
  if (!r.enough) return (
    <Card n={1} title="החודש המייצג" verdict="אין מספיק נתונים" tone="gray">
      <Empty>צריך לפחות 3 חודשים שלמים. יש כרגע {r.monthsCount}.</Empty>
    </Card>
  )
  const med = r.median, deficit = med.net < 0
  const v = r.volatility
  const volLabel = { stable: 'יציב', moderate: 'תנודתיות בינונית', volatile: 'תנודתי' }[v.level]
  const volTone  = { stable: 'green', moderate: 'amber', volatile: 'red' }[v.level]
  const headline = deficit
    ? `בחודש רגיל המשפחה מוציאה ${ils(-med.net)} יותר מהכנסתה — בקצב שנתי הפער גדל בכ־${ils(-r.annualizedNet)}.`
    : `בחודש רגיל נשארים ${ils(med.net)} — בקצב שנתי כ־${ils(r.annualizedNet)}.`
  const patternText = v.pattern === 'stable' ? 'אין חודשים חריגים — ההוצאות דומות מחודש לחודש.'
    : v.pattern === 'one-off'
      ? `חודש חריג ${v.outliers.length === 1 ? 'אחד' : ''}: ${v.outliers.map(o => `${monthName(o.month)} (${o.deviationPct > 0 ? '+' : '−'}${pct(Math.abs(o.deviationPct))})`).join(', ')}. השאר דומים — לכן החציון הוא המספר האמין.`
      : `${v.outliers.length} מתוך ${r.monthsCount} חודשים רחוקים מהחציון ביותר מ־20% — "בכל חודש הפתעה אחרת". כשזה קורה, ההפתעות הן לא באמת בלת"מים: כדאי סעיף חודשי קבוע להוצאות לא שוטפות (ראה #6).`

  const chart = r.months.map(t => ({ label: monthShort(t.month), net: Math.round(t.net), income: Math.round(t.income), expenses: Math.round(t.expenses) }))

  return (
    <Card n={1} title="החודש המייצג — הפער האמיתי" verdict={deficit ? 'פער חודשי' : 'עודף חודשי'} tone={deficit ? 'red' : 'green'} headline={headline}
      note={`חציון = הערך האמצעי בין ${r.monthsCount} החודשים, כך שחודש חריג אחד לא מזיז אותו (הממוצע הרגיל כן: הוצאות ממוצעות ${ils(r.mean.expenses)}). כל הסכומים לפי תאריך העסקה, מחשבונות שנכללים בסיכומים בלבד.`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="הכנסה בחודש מייצג" value={ils(med.income)} tone="text-emerald-300" sub={`ממוצע ${ils(r.mean.income)}`} />
        <Stat label="הוצאות בחודש מייצג" value={ils(med.expenses)} tone="text-red-300" sub={`ממוצע ${ils(r.mean.expenses)}`} />
        <Stat label={deficit ? 'חסר בחודש' : 'נשאר בחודש'} value={ils(Math.abs(med.net))} tone={deficit ? 'text-red-300' : 'text-emerald-300'}
              sub={`טווח רגיל ${signed(r.netRange.p25)} … ${signed(r.netRange.p75)}`} />
        <Stat label="תנודתיות ההוצאות" value={volLabel} tone={{ green: 'text-emerald-300', amber: 'text-amber-300', red: 'text-red-300' }[volTone]}
              sub={`הטוב: ${monthName(r.best.month)} ${signed(r.best.net)} · הגרוע: ${monthName(r.worst.month)} ${signed(r.worst.net)}`} />
      </div>
      <p className="text-sm text-gray-300 mt-3">{patternText}</p>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={64} tickFormatter={v => ils(v)} />
            <Tooltip content={<ChartTip />} cursor={{ fill: '#ffffff08' }} />
            <ReferenceLine y={0} stroke="#4b5563" />
            <ReferenceLine y={Math.round(med.net)} stroke="#60a5fa" strokeDasharray="4 4" label={{ value: 'חציון', fill: '#60a5fa', fontSize: 11, position: 'insideTopLeft' }} />
            <Bar dataKey="net" name="מאזן החודש" radius={[3, 3, 0, 0]}>
              {chart.map(c => <Cell key={c.label} fill={c.net >= 0 ? '#34d399' : '#f87171'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 2. Structural or behavioural
// ---------------------------------------------------------------------------

function StructureCard({ s }) {
  const { colorFor } = useCategories()
  if (!s.enough) return <Card n={2} title="מבני או התנהגותי?" verdict="אין מספיק נתונים" tone="gray"><Empty>צריך לפחות 3 חודשים שלמים.</Empty></Card>

  const V = {
    'balanced':   { label: 'מאוזן', tone: 'green',
      text: `אחרי ההתחייבויות הקבועות (${ils(s.fixed.total)}) נשארים ${ils(s.leftAfterFixed)} לחודש; ההוצאות המשתנות הן ${ils(s.variable.total)} — נשאר עודף של ${ils(s.gap)}.${s.heavyFixed ? ` שימו לב: הקבועות הן ${pct(s.fixed.share)} מההכנסה — מרווח הביטחון קטן.` : ''}` },
    'structural': { label: 'מבני', tone: 'red',
      text: `ההתחייבויות הקבועות לבדן — ${ils(s.fixed.total)}, כ־${pct(s.fixed.share)} מההכנסה — ${s.leftAfterFixed <= 0 ? 'עוברות את ההכנסה' : `משאירות רק ${ils(s.leftAfterFixed)} לכל שאר החיים`}. חיסכון בקניות לא יסגור את זה; צריך שינוי בהכנסה או בהתחייבות גדולה (דיור, רכב, הלוואות).` },
    'behavioral': { label: 'התנהגותי', tone: 'amber',
      text: `הקבועות (${ils(s.fixed.total)}, ${pct(s.fixed.share)} מההכנסה) משאירות ${ils(s.leftAfterFixed)} לחודש — אבל ההוצאות המשתנות הן ${ils(s.variable.total)}, כלומר ${ils(s.variable.total - s.leftAfterFixed)} מעל מה שנשאר. כאן אפשר לעבוד על הרגלים: הפער נוצר מקניות, מזון, בילויים והחלטות נקודתיות.` },
    'no-income':  { label: 'אין הכנסות רשומות', tone: 'gray',
      text: 'לא נמצאו הכנסות בקטגוריית הכנסה בחשבונות שנכללים בסיכומים, אז אי אפשר להשוות. סמן את קטגוריית המשכורת כ"הכנסה" בעמוד הקטגוריות, או כלול את חשבון הבנק בסיכומים.' },
  }[s.verdict]

  const total = Math.max(s.income, s.expenses, 1)
  const seg = (v, color, label) => v > 0 && (
    <div className="h-full flex items-center justify-center text-[11px] text-gray-950 font-medium overflow-hidden whitespace-nowrap" style={{ width: `${v / total * 100}%`, background: color }} title={`${label}: ${ils(v)}`}>
      {v / total > 0.12 ? `${label} ${ils(v)}` : ''}
    </div>
  )
  const rec = s.recurring
  const kindLabel = { monthly: 'חודשי', periodic: 'תקופתי' }

  return (
    <Card n={2} title="מבני או התנהגותי?" verdict={V.label} tone={V.tone} headline={V.text}
      note='"קבוע" = חיובים שחוזרים כמעט כל חודש (או כל חודשיים בסכום קבוע) אצל אותו ספק, בתוספת תשלומי כרטיס אשראי. הזיהוי אוטומטי לפי שם הספק — הרשימה למטה מאפשרת לבדוק אותו.'>
      <div className="space-y-1.5 mt-1">
        <div className="flex items-center gap-2 text-xs text-gray-400"><span className="w-20">הכנסה</span>
          <div className="flex-1 h-6 rounded bg-gray-800 overflow-hidden flex">{seg(s.income, '#34d399', 'הכנסה')}</div></div>
        <div className="flex items-center gap-2 text-xs text-gray-400"><span className="w-20">הוצאות</span>
          <div className="flex-1 h-6 rounded bg-gray-800 overflow-hidden flex">
            {seg(s.fixed.recurring, '#a78bfa', 'קבועות')}{seg(s.fixed.installments, '#c4b5fd', 'תשלומים')}{seg(s.variable.total, '#fbbf24', 'משתנות')}
          </div></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
        <Stat label="קבועות (ספקים חוזרים)" value={ils(s.fixed.recurring)} tone="text-violet-300" sub={`${rec.merchants.length} ספקים`} />
        <Stat label="תשלומי אשראי" value={ils(s.fixed.installments)} tone="text-violet-200" />
        <Stat label="נשאר אחרי הקבועות" value={ils(s.leftAfterFixed)} tone={s.leftAfterFixed > 0 ? 'text-emerald-300' : 'text-red-300'} sub={`קבועות = ${pct(s.fixed.share)} מההכנסה`} />
        <Stat label="משתנות בפועל" value={ils(s.variable.total)} tone="text-amber-300" sub={s.variable.topCategories.slice(0, 3).map(c => c.category).join(' · ')} />
      </div>

      {(rec.changes.new.length + rec.changes.gone.length + rec.changes.increased.length) > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-3 text-xs">
          {rec.changes.new.length > 0 && (
            <div className="bg-gray-800/60 rounded-lg p-2.5">
              <div className="text-blue-300 font-medium mb-1">חיוב חוזר חדש (מ־{monthName(rec.changes.new[0].since)})</div>
              {rec.changes.new.map(c => <div key={c.key} className="flex justify-between gap-2 text-gray-300"><span className="truncate" dir="auto">{c.description}</span><span className="font-mono shrink-0">{ils(c.typical)}</span></div>)}
              <div className="text-gray-500 mt-1">מנוי חדש? אם לא מתוכנן — שווה לבדוק.</div>
            </div>
          )}
          {rec.changes.gone.length > 0 && (
            <div className="bg-gray-800/60 rounded-lg p-2.5">
              <div className="text-gray-300 font-medium mb-1">לא נראו בחודשיים האחרונים</div>
              {rec.changes.gone.map(c => <div key={c.key} className="flex justify-between gap-2 text-gray-300"><span className="truncate" dir="auto">{c.description}</span><span className="font-mono shrink-0">{ils(c.typical)}</span></div>)}
              <div className="text-gray-500 mt-1">בוטל, עונתי (חוגים בקיץ?) או שם ספק שהשתנה.</div>
            </div>
          )}
          {rec.changes.increased.length > 0 && (
            <div className="bg-gray-800/60 rounded-lg p-2.5">
              <div className="text-amber-300 font-medium mb-1">התייקרו</div>
              {rec.changes.increased.map(c => <div key={c.key} className="flex justify-between gap-2 text-gray-300"><span className="truncate" dir="auto">{c.description}</span><span className="font-mono shrink-0">{ils(c.from)} → {ils(c.to)}</span></div>)}
            </div>
          )}
        </div>
      )}

      <Details label={`רשימת החיובים הקבועים שזוהו (${rec.merchants.length})`}>
        <table className="w-full text-xs">
          <tbody>
            {rec.merchants.map(m => (
              <tr key={m.key} className="border-b border-gray-800/50">
                <td className="py-1.5 pl-2 text-gray-200 max-w-0" style={{ width: '100%' }}><div className="truncate" dir="auto">{m.description}</div></td>
                <td className="py-1.5 px-2 text-gray-400 whitespace-nowrap"><span className="inline-flex items-center gap-1"><CatDot name={m.category} />{m.category}</span></td>
                <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">{kindLabel[m.kind]} · {m.monthsPresent} ח'</td>
                <td className="py-1.5 pr-2 font-mono text-gray-200 whitespace-nowrap text-left">{ils(m.avgPerMonth)}<span className="text-gray-600 text-[10px]"> /חודש</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Details>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 3. Gap drivers
// ---------------------------------------------------------------------------

function DriversCard({ d, deficit }) {
  const { colorFor } = useCategories()
  if (!d.enough) return <Card n={3} title="מה יוצר את הפער?" verdict="אין מספיק נתונים" tone="gray"><Empty>צריך לפחות 3 חודשים שלמים.</Empty></Card>
  const pat = { 'many-small': ['הרבה קטנות', 'amber'], 'few-large': ['מעט גדולות', 'blue'], 'mixed': ['מעורב', 'gray'] }
  const top = d.top
  const headline = top.length
    ? `${top.slice(0, 3).map(c => `${c.category} (${ils(c.avgPerMonth)})`).join(', ')} — יחד ${pct(top.slice(0, 3).reduce((s, c) => s + c.share, 0))} מההוצאות.${d.overBudget.length ? ` מול התקציב, החריגות הגדולות הן ב${d.overBudget.slice(0, 2).map(c => c.category).join(' ו')}.` : ''}`
    : 'אין הוצאות בתקופה.'

  const Row = ({ c, over }) => {
    const [pl, pt] = pat[c.pattern]
    return (
      <div className="py-2 border-b border-gray-800/50 last:border-0">
        <div className="flex items-center gap-2 text-sm">
          <CatDot name={c.category} />
          <span className="text-white font-medium">{c.category}</span>
          <Chip tone={pt}>{pl}</Chip>
          <span className="ms-auto font-mono text-gray-200">{ils(over ? c.overAvg : c.avgPerMonth)}<span className="text-gray-500 text-xs"> /חודש</span></span>
        </div>
        <div className="mt-1.5"><ShareBar value={over ? c.overAvg / Math.max(1, d.overBudget[0].overAvg) : c.share} color={colorFor(c.category)} /></div>
        <div className="text-xs text-gray-400 mt-1">
          {over
            ? <>תקציב {ils(c.budgetAvg)} · הוצאה {ils(c.avgPerMonth)} · חריגה ב־{c.monthsOver} מתוך {c.budgetMonths} חודשים</>
            : <>{pct(c.share)} מההוצאות · {n1(c.countPerMonth)} חיובים בחודש · ממוצע {ils(c.avgTicket)} לחיוב{c.budgetAvg != null && <> · תקציב {ils(c.budgetAvg)}</>}</>}
        </div>
      </div>
    )
  }

  return (
    <Card n={3} title="מה יוצר את הפער?" verdict={deficit ? 'הסעיפים שמייצרים את הפער' : 'הסעיפים הגדולים'} tone={deficit ? 'red' : 'blue'} headline={headline}
      note='"הרבה קטנות" = 10 חיובים או יותר בחודש: הבעיה היא לא קנייה אחת גדולה אלא הצטברות. "מעט גדולות" = עד 3 חיובים: כל אחד מהם הוא החלטה.'>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs text-gray-500 mb-1">לפי סכום</div>
          {top.map(c => <Row key={c.category} c={c} />)}
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">לפי חריגה מהתקציב</div>
          {d.overBudget.length ? d.overBudget.map(c => <Row key={c.category} c={c} over />) : <Empty>אין חריגות מהתקציב בקטגוריות מתוקצבות.</Empty>}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 4. Budget realism
// ---------------------------------------------------------------------------

function RealismCard({ b }) {
  if (!b.enough) return <Card n={4} title="תקציב ריאלי או משאלת לב?" verdict="אין תקציבים לבדוק" tone="gray"><Empty>הגדר תקציבים בעמוד "תקציבים" — כאן נראה אילו מהם מחזיקים מים.</Empty></Card>
  const V = { wishful: ['משאלת לב', 'red'], realistic: ['ריאלי', 'green'], loose: ['רפוי', 'blue'] }
  const s = b.summary
  const headline = s.wishful
    ? `${s.wishful} תקציבים הם משאלת לב — בפועל מוציאים עליהם יחד ${ils(s.planningGap)} יותר בחודש ממה שתוכנן. ${s.realistic} ריאליים${s.loose ? `, ${s.loose} רפויים (התקציב גבוה בהרבה מהמציאות)` : ''}.`
    : `כל ${s.realistic + s.loose} התקציבים מחזיקים: ${s.realistic} ריאליים${s.loose ? `, ${s.loose} רפויים` : ''}.`
  return (
    <Card n={4} title="תקציב ריאלי או משאלת לב?" verdict={s.wishful ? `${s.wishful} משאלות לב` : 'התקציבים ריאליים'} tone={s.wishful ? 'red' : 'green'} headline={headline}
      note="משאלת לב = חריגה ב־⅔ מהחודשים לפחות והחציון גבוה מהתקציב ב־10%+. במקרה כזה יש שתי אפשרויות אמיתיות: לשנות התנהלות, או להעלות את התקציב למספר שמתאר אותכם — ואז לקבל את המשמעות במאזן. רפוי = חריגה נדירה והחציון נמוך מ־70% מהתקציב.">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-right py-2 pl-2 font-medium">קטגוריה</th>
              <th className="text-left py-2 px-2 font-medium">תקציב</th>
              <th className="text-left py-2 px-2 font-medium">חציון בפועל</th>
              <th className="text-center py-2 px-2 font-medium">חודשים בחריגה</th>
              <th className="text-right py-2 px-2 font-medium">מסקנה</th>
              <th className="text-left py-2 pr-2 font-medium">הצעה</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map(r => {
              const [label, tone] = V[r.verdict]
              return (
                <tr key={r.category} className="border-b border-gray-800/50">
                  <td className="py-2 pl-2 text-gray-200"><span className="inline-flex items-center gap-1.5"><CatDot name={r.category} />{r.category}</span></td>
                  <td className="py-2 px-2 font-mono text-gray-300 text-left">{ils(r.budget)}</td>
                  <td className={`py-2 px-2 font-mono text-left ${r.median > r.budget ? 'text-red-300' : 'text-gray-300'}`}>{ils(r.median)}<span className="text-gray-600"> ({pct(r.ratio)})</span></td>
                  <td className="py-2 px-2 text-center text-gray-300">{r.monthsOver} / {r.monthsBudgeted}</td>
                  <td className="py-2 px-2"><Chip tone={tone}>{label}</Chip></td>
                  <td className="py-2 pr-2 font-mono text-left text-blue-300">{r.suggested != null ? ils(r.suggested) : <span className="text-gray-600">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5. Progress
// ---------------------------------------------------------------------------

function Delta({ v, goodWhenDown = true, fmt = ils }) {
  if (Math.abs(v) < 0.5) return <span className="text-gray-500 inline-flex items-center gap-0.5"><Minus className="w-3 h-3" />ללא שינוי</span>
  const good = goodWhenDown ? v < 0 : v > 0
  const Icon = v > 0 ? ArrowUpRight : ArrowDownRight
  return <span className={`inline-flex items-center gap-0.5 font-mono ${good ? 'text-emerald-300' : 'text-red-300'}`}><Icon className="w-3.5 h-3.5" />{v > 0 ? '+' : '−'}{fmt(Math.abs(v))}</span>
}

function ProgressCard({ p }) {
  if (!p.enough) return <Card n={5} title="האם יש שיפור?" verdict="אין מספיק נתונים" tone="gray"><Empty>צריך לפחות 4 חודשים שלמים כדי להשוות שתי תקופות. יש כרגע {p.monthsCount}.</Empty></Card>
  const V = { improving: ['משתפר', 'green'], worsening: ['מחמיר', 'red'], flat: ['ללא שינוי מהותי', 'gray'] }[p.verdict]
  const span = ms => `${monthName(ms[0])}–${monthName(ms[ms.length - 1])}`
  const headline = `${span(p.recent.months)} מול ${span(p.previous.months)}: הוצאות ${p.delta.expenses > 0 ? 'עלו' : 'ירדו'} ב־${pct(Math.abs(p.delta.expensesPct))} (${signed(p.delta.expenses)} בחודש), המאזן החודשי ${p.delta.net >= 0 ? 'השתפר' : 'הורע'} ב־${ils(Math.abs(p.delta.net))}, חריגות תקציב ${n1(p.previous.breachesPerMonth)} → ${n1(p.recent.breachesPerMonth)} בחודש.`
  const Period = ({ t, title, tone }) => (
    <div className={`rounded-lg p-3 ${tone}`}>
      <div className="text-xs text-gray-400 mb-2">{title} <span className="text-gray-600">({t.months.map(monthShort).join(', ')})</span></div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <span className="text-gray-400">הכנסות</span><span className="font-mono text-emerald-300 text-left">{ils(t.income)}</span>
        <span className="text-gray-400">הוצאות</span><span className="font-mono text-red-300 text-left">{ils(t.expenses)}</span>
        <span className="text-gray-400">מאזן</span><span className={`font-mono text-left ${t.net >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{signed(t.net)}</span>
        <span className="text-gray-400">חריגות תקציב</span><span className="font-mono text-gray-200 text-left">{n1(t.breachesPerMonth)} <span className="text-gray-600 text-xs">/חודש</span></span>
        <span className="text-gray-400">לא מסווג ("אחר")</span><span className="font-mono text-gray-200 text-left">{pct(t.otherShare)}</span>
      </div>
    </div>
  )
  return (
    <Card n={5} title="האם יש שיפור?" verdict={V[0]} tone={V[1]} headline={headline}
      note='זהירות עם עונתיות: חודשי קיץ, חגים או חופשה בצד אחד של ההשוואה מטים את התמונה. "לא מסווג" יורד = הרישום מדויק יותר, וזה כבר שיפור.'>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] items-stretch">
        <Period t={p.previous} title="לפני" tone="bg-gray-800/40" />
        <div className="flex flex-col justify-center gap-1 text-xs px-2">
          <div className="text-gray-500">הוצאות <Delta v={p.delta.expenses} /></div>
          <div className="text-gray-500">הכנסות <Delta v={p.delta.income} goodWhenDown={false} /></div>
          <div className="text-gray-500">מאזן <Delta v={p.delta.net} goodWhenDown={false} /></div>
          <div className="text-gray-500">חריגות <Delta v={p.delta.breachesPerMonth} fmt={n1} /></div>
        </div>
        <Period t={p.recent} title="לאחרונה" tone="bg-blue-900/20 border border-blue-800/30" />
      </div>
      {(p.movers.up.length + p.movers.down.length) > 0 && (
        <div className="grid gap-3 lg:grid-cols-2 mt-3 text-sm">
          <div>
            <div className="text-xs text-red-300 mb-1">עלו הכי הרבה</div>
            {p.movers.up.length ? p.movers.up.map(m => <div key={m.category} className="flex justify-between py-1 border-b border-gray-800/50"><span className="inline-flex items-center gap-1.5 text-gray-200"><CatDot name={m.category} />{m.category}</span><span className="font-mono text-red-300">{ils(m.from)} → {ils(m.to)} <span className="text-gray-500 text-xs">(+{pct(m.pct)})</span></span></div>) : <Empty>—</Empty>}
          </div>
          <div>
            <div className="text-xs text-emerald-300 mb-1">ירדו הכי הרבה</div>
            {p.movers.down.length ? p.movers.down.map(m => <div key={m.category} className="flex justify-between py-1 border-b border-gray-800/50"><span className="inline-flex items-center gap-1.5 text-gray-200"><CatDot name={m.category} />{m.category}</span><span className="font-mono text-emerald-300">{ils(m.from)} → {ils(m.to)} <span className="text-gray-500 text-xs">(−{pct(Math.abs(m.pct))})</span></span></div>) : <Empty>—</Empty>}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 6. Periodic expenses
// ---------------------------------------------------------------------------

function PeriodicCard({ p }) {
  const { colorFor } = useCategories()
  if (!p.enough) return <Card n={6} title="הוצאות תקופתיות שלא בתקציב החודשי" verdict="אין מספיק נתונים" tone="gray"><Empty>צריך לפחות 4 חודשים שלמים.</Empty></Card>
  const headline = p.items.length
    ? `ב־${p.coverage.months.length} החודשים היו ${ils(p.total)} הוצאות חד־פעמיות גדולות — ${pct(p.shareOfExpenses)} מכל ההוצאות. כדי שהן יפסיקו להיות "הפתעה", כדאי להפריש כ־${ils(p.provision)} בחודש לסעיף הוצאות לא שוטפות.`
    : 'לא נמצאו הוצאות חד־פעמיות גדולות בתקופה.'
  const maxCat = p.byCategory[0]?.total || 1
  return (
    <Card n={6} title="הוצאות תקופתיות שלא בתקציב החודשי" verdict={p.items.length ? `הפרשה ${ils(p.provision)} בחודש` : 'אין'} tone={p.items.length ? 'amber' : 'green'} headline={headline}
      note={`נספרו ספקים שהופיעו בחודש–חודשיים בלבד מתוך ${p.coverage.months.length}, עם חיוב של ${ils(p.threshold)} ומעלה (הסף מותאם לגודל ההוצאה החודשית שלכם). התקופה מכסה ${monthLong(p.coverage.from)}–${monthLong(p.coverage.to)}: הוצאות שנתיות שנופלות בחודשים אחרים (חגים, ביטוחים, חופשות) עדיין לא מופיעות פה — ההפרשה האמיתית כנראה גבוהה יותר.`}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs text-gray-500 mb-1">לפי קטגוריה</div>
          {p.byCategory.map(c => (
            <div key={c.category} className="py-1.5">
              <div className="flex items-center gap-2 text-sm"><CatDot name={c.category} /><span className="text-gray-200">{c.category}</span><span className="ms-auto font-mono text-gray-200">{ils(c.total)}</span></div>
              <div className="mt-1"><ShareBar value={c.total / maxCat} color={colorFor(c.category)} /></div>
            </div>
          ))}
          {p.lumpyCategories.length > 0 && (
            <div className="mt-3 text-xs text-gray-400">
              <span className="text-gray-300">קטגוריות "קופצניות"</span> (ההוצאה בהן משתנה מאוד מחודש לחודש): {p.lumpyCategories.map(c => `${c.category} (ממוצע ${ils(c.avgPerMonth)}, שיא ${ils(c.max)})`).join(' · ')}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">ההוצאות עצמן</div>
          <div className="max-h-72 overflow-y-auto pl-3">
            <table className="w-full text-xs">
              <tbody>
                {p.items.map(i => (
                  <tr key={i.key} className="border-b border-gray-800/50">
                    <td className="py-1.5 pl-2 text-gray-500 whitespace-nowrap align-top">{i.months.map(monthShort).join(', ')}</td>
                    <td className="py-1.5 px-2 max-w-0 align-top" style={{ width: '100%' }}>
                      <div className="text-gray-200 truncate" dir="auto">{i.description}</div>
                      <div className="text-gray-500 inline-flex items-center gap-1"><CatDot name={i.category} />{i.category}{i.count > 1 && <> · {i.count} חיובים</>}</div>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-gray-200 whitespace-nowrap text-left align-top">{ils(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 7. Installments and debts
// ---------------------------------------------------------------------------

function InstallmentsCard({ s }) {
  const hasPlans = s.plans.length > 0
  const headline = hasPlans
    ? `החודש ${ils(s.monthlyBurden)} הולכים לתשלומי אשראי${s.shareOfIncome != null ? ` (${pct(s.shareOfIncome)} מההכנסה)` : ''}, ב־${s.plans.length} תוכניות פעילות. סך התשלומים שנותרו: ${ils(s.remainingDebt)}.${s.endingSoon.length ? ` עד ${monthLong(s.endingSoon[s.endingSoon.length - 1].endMonth)} יסתיימו ${s.endingSoon.length} תוכניות ויתפנו ${ils(s.endingSoon.reduce((a, p) => a + p.perMonth, 0))} בחודש.` : ''}`
    : 'אין תוכניות תשלומים פעילות בכרטיסי האשראי.'
  const chart = s.schedule.map(m => ({ label: monthShort(m.month), amount: Math.round(m.amount), ending: m.ending }))
  const newText = s.newInWindow.count
    ? `בתקופה נפתחו ${s.newInWindow.count} תוכניות תשלומים חדשות בסך ${ils(s.newInWindow.total)}${s.plans.length && s.newInWindow.count >= 3 ? ' — תשלומים חדשים נכנסים בקצב שבו ישנים נסגרים; שווה לשים לב אם זה כלי מימון קבוע.' : '.'}`
    : 'בתקופה לא נפתחו תוכניות תשלומים חדשות.'
  return (
    <Card n={7} title="תשלומים וחובות" verdict={hasPlans ? `${ils(s.monthlyBurden)} בחודש` : 'אין תשלומים'} tone={hasPlans ? (s.shareOfIncome > 0.1 ? 'red' : 'amber') : 'green'} headline={headline}
      note="התוכניות משוחזרות מחיובי הכרטיס (מספר תשלום מתוך סך). תוכנית שלא נראתה 3 חודשים ומעלה אבל לא הסתיימה נחשבת לא־פעילה (בוטלה או שהכרטיס לא מסונכרן) ולא נכללת בתחזית. הלוואות בנקאיות מגיעות מגיליון הנכסים (התחייבויות) ומתעדכנות ידנית.">
      <p className="text-sm text-gray-300 mb-3">
        {newText}
        {s.finishedRecently.length > 0 && <> בשלושת החודשים האחרונים הסתיימו {s.finishedRecently.length} תוכניות — התפנו {ils(s.finishedRecently.reduce((a, p) => a + p.perMonth, 0))} בחודש.</>}
      </p>
      {hasPlans && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">כמה כבר "תפוס" בחודשים הקרובים</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={false} interval={1} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={60} tickFormatter={v => ils(v)} />
                <Tooltip content={<ChartTip />} cursor={{ fill: '#ffffff08' }} />
                <Bar dataKey="amount" name="תשלומים" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">תוכניות פעילות</div>
            <div className="max-h-64 overflow-y-auto pl-3">
              <table className="w-full text-xs">
                <tbody>
                  {s.plans.map(p => (
                    <tr key={p.description + p.startMonth + p.total} className="border-b border-gray-800/50">
                      <td className="py-1.5 pl-2 max-w-0" style={{ width: '100%' }}>
                        <div className="text-gray-200 truncate" dir="auto">{p.description}{p.multiplicity > 1 && <span className="text-gray-500"> ×{p.multiplicity}</span>}</div>
                        <div className="text-gray-500">שולמו {p.paid}/{p.total} · מסתיים {monthLong(p.endMonth)} · נותרו {ils(p.remainingAmount)}</div>
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-gray-200 whitespace-nowrap text-left align-top">{ils(p.perMonth)}<span className="text-gray-600 text-[10px]"> /חודש</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {(s.liabilities.length > 0 || s.stalePlans.length > 0 || s.unknown.count > 0) && (
        <div className="mt-3 grid gap-2 lg:grid-cols-3 text-xs">
          {s.liabilities.length > 0 && (
            <div className="bg-gray-800/60 rounded-lg p-2.5">
              <div className="text-gray-300 font-medium mb-1">הלוואות (מגיליון הנכסים) — {ils(s.liabilitiesTotal)}</div>
              {s.liabilities.map(l => <div key={l.id} className="flex justify-between gap-2 text-gray-400"><span className="truncate">{l.institution} · {l.label || l.asset_type}</span><span className="font-mono shrink-0">{l.balance != null ? ils(l.balance) : '—'}{l.asOf && <span className="text-gray-600"> ({monthShort(l.asOf.slice(0, 7))})</span>}</span></div>)}
            </div>
          )}
          {s.stalePlans.length > 0 && (
            <div className="bg-gray-800/60 rounded-lg p-2.5">
              <div className="text-gray-300 font-medium mb-1">תוכניות שלא נראו לאחרונה ({s.stalePlans.length})</div>
              {s.stalePlans.map(p => <div key={p.description + p.startMonth} className="flex justify-between gap-2 text-gray-400"><span className="truncate" dir="auto">{p.description}</span><span className="font-mono shrink-0">{p.paid}/{p.total} · {monthShort(p.lastSeen)}</span></div>)}
            </div>
          )}
          {s.unknown.count > 0 && (
            <div className="bg-gray-800/60 rounded-lg p-2.5 text-gray-400">
              {s.unknown.count} חיובי תשלומים בתקופה ({ils(s.unknown.total)}) ללא פירוט מספר/סך — נכללים בהוצאות אבל לא בתחזית.
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The four-line summary at the top
// ---------------------------------------------------------------------------

function Summary({ d }) {
  const r = d.representative, s = d.structure, dr = d.drivers, b = d.budgetRealism, p = d.progress, pe = d.periodic, ins = d.installments
  if (!r.enough) return null
  const deficit = r.median.net < 0
  const lines = []
  lines.push(['כך נראה החודש הרגיל שלכם', `הכנסה ${ils(r.median.income)}, הוצאות ${ils(r.median.expenses)} — ${deficit ? `חסרים ${ils(-r.median.net)}` : `נשארים ${ils(r.median.net)}`} בחודש${s.verdict === 'structural' ? ', והבעיה מבנית (התחייבויות קבועות)' : s.verdict === 'behavioral' ? ', והפער נובע מהוצאות משתנות' : ''}.`])
  if (dr.top.length) {
    const src = deficit && dr.overBudget.length ? dr.overBudget : dr.top
    lines.push([deficit ? 'שלושת הדברים שיוצרים את הפער' : 'שלושת הסעיפים הגדולים', src.slice(0, 3).map(c => `${c.category} (${ils(deficit && dr.overBudget.length ? c.overAvg : c.avgPerMonth)}${deficit && dr.overBudget.length ? ' מעל התקציב' : ''})`).join(', ') + '.'])
  }
  if (p.enough) {
    lines.push(['מה השתנה לאחרונה', p.verdict === 'improving' ? `שיפור: הוצאות ${signed(p.delta.expenses)} בחודש, מאזן ${signed(p.delta.net)}${p.movers.down.length ? ` — בעיקר ${p.movers.down.map(m => m.category).join(', ')}` : ''}.`
      : p.verdict === 'worsening' ? `הרעה: הוצאות ${signed(p.delta.expenses)} בחודש, מאזן ${signed(p.delta.net)}${p.movers.up.length ? ` — בעיקר ${p.movers.up.map(m => m.category).join(', ')}` : ''}.`
      : 'ללא שינוי מהותי בין שתי מחציות התקופה.'])
  }
  const todo = []
  if (b.enough && b.summary.wishful) todo.push(`${b.summary.wishful} תקציבים לא ריאליים (${ils(b.summary.planningGap)} בחודש מוסתרים)`)
  if (pe.enough && pe.provision) todo.push(`הפרשה של ${ils(pe.provision)} בחודש להוצאות לא שוטפות`)
  if (s.recurring.changes.new.length) todo.push(`${s.recurring.changes.new.length} חיובים חוזרים חדשים`)
  if (s.recurring.changes.increased.length) todo.push(`${s.recurring.changes.increased.length} חיובים שהתייקרו`)
  if (ins.endingSoon.length) todo.push(`${ils(ins.endingSoon.reduce((a, x) => a + x.perMonth, 0))} בחודש שיתפנו מתשלומים עד ${monthLong(ins.endingSoon[ins.endingSoon.length - 1].endMonth)}`)
  if (todo.length) lines.push(['מה כדאי לבדוק', todo.join(' · ') + '.'])

  return (
    <div className="bg-gradient-to-br from-blue-950/60 to-gray-900 border border-blue-900/40 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3"><Lightbulb className="w-5 h-5 text-amber-300" /><h3 className="text-white font-semibold">בארבע שורות</h3></div>
      <ol className="space-y-2">
        {lines.map(([k, v]) => <li key={k} className="text-sm"><span className="text-blue-300 font-medium">{k}: </span><span className="text-gray-200">{v}</span></li>)}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const WINDOWS = [['3', '3 חודשים'], ['6', '6 חודשים'], ['12', '12 חודשים'], ['all', 'הכל']]

export default function InsightsPage() {
  const [months, setMonths] = useState('6')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    axios.get('/api/insights', { params: { months } })
      .then(res => setData(res.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [months])

  const w = data?.window
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">תובנות</h2>
          <p className="text-sm text-gray-400 mt-1">
            שבע שאלות על המנגנון הכלכלי של המשפחה, על בסיס חודשים שלמים בלבד
            {w?.count ? <> — <span className="text-gray-300">{monthLong(w.from)}–{monthLong(w.to)}</span> ({w.count} חודשים; {monthName(w.currentMonth)} הנוכחי לא נכלל)</> : null}.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
          {WINDOWS.map(([k, label]) => (
            <button key={k} onClick={() => setMonths(k)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${months === k ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="text-gray-400">מחשב תובנות...</div>
      : error ? <div className="text-red-400">שגיאה: {error}</div>
      : !w?.count ? <div className="text-center py-16 text-gray-500">אין עדיין חודשים שלמים עם נתונים.</div>
      : (
        <>
          <Summary d={data} />
          <div className="space-y-6">
            <RepresentativeCard r={data.representative} window={w} />
            <StructureCard s={data.structure} />
            <DriversCard d={data.drivers} deficit={data.representative.enough && data.representative.median.net < 0} />
            <RealismCard b={data.budgetRealism} />
            <ProgressCard p={data.progress} />
            <PeriodicCard p={data.periodic} />
            <InstallmentsCard s={data.installments} />
          </div>
        </>
      )}
    </div>
  )
}
