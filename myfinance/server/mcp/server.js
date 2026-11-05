#!/usr/bin/env node
/**
 * MyBudget MCP server — read-only access to the family budget for any assistant
 * that speaks MCP (Claude Desktop, Claude Code, Gemini CLI, ...).
 *
 * It runs on this machine, talks over stdin/stdout, and opens the SQLite file
 * READ-ONLY: there is no tool here that writes, deletes or syncs anything, and
 * the encrypted bank credentials are never read (see mcp/tools.js).
 *
 * Nothing leaves the machine by itself. Data reaches an assistant only when you
 * ask a question and it calls one of these tools — the same as pasting the
 * numbers into a chat yourself.
 *
 * Run:  node server/mcp/server.js       (normally started by the assistant)
 * Setup instructions: docs/MCP_SETUP.md
 *
 * NOTE for anyone editing this file: a stdio MCP server must never print to
 * stdout — that channel carries the protocol. Log to stderr (console.error).
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { DB_PATH } from '../db/database.js'
import {
  listAccounts, upcomingCardCharges, monthlySummary, categoryBreakdown,
  searchTransactions, budgetStatus, insights, netWorthSnapshot,
} from './tools.js'

if (!fs.existsSync(DB_PATH)) {
  console.error(`MyBudget MCP: database not found at ${DB_PATH}. Start the app once to create it.`)
  process.exit(1)
}

// readOnly: no tool here can write, and SQLite enforces it at the file level.
// timeout: the app uses a rollback journal (not WAL), so while a bank sync is
// writing, a reader is locked out — wait a few seconds instead of failing.
const db = new DatabaseSync(DB_PATH, { readOnly: true, timeout: 5000 })

const server = new McpServer({ name: 'mybudget', version: '1.0.0' })

/** Wrap a tool so a failure comes back as a readable message, not a crash. */
function tool(name, config, run) {
  server.registerTool(name, { ...config, annotations: { readOnlyHint: true, ...config.annotations } }, async args => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(run(args || {}), null, 2) }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `${name} failed: ${err.message}` }] }
    }
  })
}

const MONEY = 'Amounts are in ILS. Expenses are negative, income positive. Category names are in Hebrew.'
const COUNTS = 'Only accounts and cards the user kept in the totals are counted, like everywhere in the app.'

tool('list_accounts', {
  title: 'Accounts and cards',
  description:
    `Every bank login and credit card: its balance (banks) or upcoming charge (cards), who owns it, ` +
    `how many transactions it has, when it was last synced, and whether it counts toward the totals. ` +
    `Bank credentials are never exposed. ${MONEY}`,
  inputSchema: {},
}, () => listAccounts(db))

tool('upcoming_card_charges', {
  title: 'Upcoming credit-card charges',
  description:
    `What the credit cards are about to debit from the bank accounts: each card's next charge with its ` +
    `charge date, and the total. A charge keeps growing until its date, as new purchases land on it. ${COUNTS}`,
  inputSchema: {},
}, () => upcomingCardCharges(db))

tool('net_balance', {
  title: 'Net balance right now',
  description:
    `The net bank balance across the accounts that count, and the credit-card money that has not left ` +
    `the accounts yet. Use it for "how much do we have right now". ${MONEY}`,
  inputSchema: {},
}, () => netWorthSnapshot(db))

tool('monthly_summary', {
  title: 'Income and expenses by month',
  description:
    `Income, expenses and the gap for each of the last N months, most recent last. The current month is ` +
    `flagged partial — never compare it with full months. ${COUNTS} ${MONEY}`,
  inputSchema: { months: z.number().int().min(1).max(36).optional().describe('How many months back, including the current one. Default 6.') },
}, a => monthlySummary(db, a))

tool('category_breakdown', {
  title: 'Spending by category',
  description:
    `Expenses grouped by category over a date range, largest first, with each category's share of the ` +
    `total. Use it for "what did we spend the most on". ${COUNTS} ${MONEY}`,
  inputSchema: {
    from: z.string().optional().describe("Start date, 'YYYY-MM-DD'. Omit for no lower bound."),
    to: z.string().optional().describe("End date, 'YYYY-MM-DD'. Omit for no upper bound."),
    limit: z.number().int().min(1).max(100).optional().describe('How many categories. Default 15.'),
  },
}, a => categoryBreakdown(db, a))

tool('search_transactions', {
  title: 'Find transactions',
  description:
    `Search transactions by free text (matches the merchant description, the bank memo and the user's own ` +
    `note), category, and date range. Newest first. ${MONEY}`,
  inputSchema: {
    text: z.string().optional().describe('Free text, e.g. a merchant name. Hebrew works.'),
    category: z.string().optional().describe('Exact category name (Hebrew), e.g. מזון.'),
    from: z.string().optional().describe("Start date, 'YYYY-MM-DD'."),
    to: z.string().optional().describe("End date, 'YYYY-MM-DD'."),
    limit: z.number().int().min(1).max(500).optional().describe('Maximum rows. Default 50.'),
    all_accounts: z.boolean().optional().describe('true also searches accounts and cards kept out of the totals. Default false.'),
  },
}, a => searchTransactions(db, a))

tool('budget_status', {
  title: 'Budget vs actual',
  description:
    `For one month: each category's budget, what was actually spent, and the difference. ` +
    `Use it for "are we within budget". ${MONEY}`,
  inputSchema: { month: z.string().optional().describe("Month as 'YYYY-MM'. Default: the current month.") },
}, a => budgetStatus(db, a))

tool('insights', {
  title: 'Monthly insights',
  description:
    `The analysis behind the app's Insights page, computed over complete months only: what a normal month ` +
    `looks like (typical income, median expenses, the real gap), whether a deficit is structural or ` +
    `behavioural, which categories drive it, which budgets are realistic, whether things are improving, ` +
    `irregular expenses worth setting aside for, and the installment load. Prefer this over doing the ` +
    `arithmetic yourself. ${MONEY}`,
  inputSchema: { monthsBack: z.number().int().min(3).max(36).optional().describe('How many complete months to analyse. Default 6.') },
}, a => insights(db, a))

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`MyBudget MCP ready (read-only): ${DB_PATH}`)
