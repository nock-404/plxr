"use client";

import { tr } from "@/lib/i18n";
import { accountName, until } from "@/lib/format";
import { useLimits } from "@/lib/useLimits";
import type { AccountUsage } from "@/lib/types";

/* What is left, per account, and nothing else.
 *
 * The usage panel says everything there is to say — spend by model, by day, by
 * window, the whole history. Beside the work that is one question: can this
 * account still take a run? So he asked for a window of its own (translated,
 * 16.09.2026): "an extra one in the bottom bar with the accounts, and then only
 * see how much I have left in the current session and in general. not much
 * blah."
 *
 * So: one line per account, two numbers. What is free in the five-hour window
 * that is running, and what is free of the week. A window the service could not
 * read says so instead of showing a number nobody measured.
 */

const free = (percent: number) => Math.max(0, Math.min(100, Math.round(100 - percent)));

function Left({ what, left, known, resetsAt }: { what: string; left: number; known: boolean; resetsAt: number }) {
  return (
    <span className="accFigure" data-low={known && left <= 20 ? "yes" : "no"}>
      <span className="accWhat">{what}</span>
      {known ? (
        <>
          <span className="accLeft">{tr("accounts.free", "{n}% free", { n: left })}</span>
          {resetsAt ? <span className="accBack">{until(resetsAt)}</span> : null}
        </>
      ) : (
        <span className="accBack">{tr("accounts.unknown", "not read")}</span>
      )}
    </span>
  );
}

export default function Accounts() {
  const { report } = useLimits();
  // Nothing before the first answer: "no accounts" while it is still asking is
  // the lie the gates look for.
  if (!report) return <div className="accounts" />;
  const accounts: AccountUsage[] = report.accounts ?? [];
  if (accounts.length === 0) {
    return (
      <div className="accounts">
        <div className="emptyNote">
          <b>{tr("accounts.emptyHead", "no accounts")}</b>
          {tr("accounts.empty", "Sessions run under an account; the ones plxr knows stand here with what is left of them.")}
        </div>
      </div>
    );
  }
  return (
    <div className="accounts">
      {accounts.map((a) => (
        <div className="accRow" key={a.name} data-account={a.name}>
          <span className="accName">{accountName(a)}</span>
          <Left what={tr("accounts.session", "session")} left={free(a.session.percent)} known={a.session.known} resetsAt={a.session.resetsAt} />
          <Left what={tr("accounts.week", "week")} left={free(a.week.percent)} known={a.week.known} resetsAt={a.week.resetsAt} />
        </div>
      ))}
    </div>
  );
}
