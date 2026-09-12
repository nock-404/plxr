"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import Input from "@/components/ui/Input";
import LinkButton from "@/components/ui/LinkButton";
import TopStrip from "@/components/ui/TopStrip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { copyText, openInBrowser } from "@/lib/browser";

/* A web page in a panel — the dev server a session is running, beside its
 * terminal. Point it at a port and it shows what that port serves.
 *
 * It is a plain iframe: the page is not plxr's to script, only to show. A dev
 * server that refuses to be framed (X-Frame-Options: deny) comes up blank, and
 * OPEN sends it to a real browser instead — nothing plxr can do about a server
 * that says no to framing.
 */
export default function Preview({ url }: { url: string }) {
  const [address, setAddress] = useState(url);
  const [live, setLive] = useState(url);
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setAddress(url);
    setLive(url);
  }, [url]);

  function go(next: string) {
    let u = next.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
    setLive(u);
    setNonce((n) => n + 1);
  }

  const ctx = useContextMenu();
  /* The panel's own menu, on its bar and its empty state. The framed page is
     another document: a right-click inside it is that page's, not plxr's. */
  const panelMenu: MenuItem[] = [
    { label: tr("preview.reload", "Reload"), disabled: !live, onClick: () => setNonce((n) => n + 1) },
    { label: tr("preview.menuBrowser", "Open in browser"), disabled: !live, onClick: () => openInBrowser(live) },
    { label: tr("preview.menuCopyUrl", "Copy URL"), disabled: !live, onClick: () => copyText(live) },
    { separator: true },
    {
      label: tr("preview.menuEditUrl", "Edit URL"),
      onClick: () => {
        field.current?.focus();
        field.current?.select();
      },
    },
  ];

  return (
    <div className="preview" onContextMenu={ctx(panelMenu)}>
      <TopStrip>
        <div className="previewbar">
          <span className="prompt">{tr("preview.prompt", "url>")}</span>
          <Input
            ref={field}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(address);
            }}
            placeholder={tr("preview.placeholder", "localhost:3000")}
          />
          <Button tiny onClick={() => go(address)}>
            {tr("preview.go", "GO")}
          </Button>
          <Tooltip text={tr("preview.reload", "Reload")}>
            <Button tiny onClick={() => setNonce((n) => n + 1)}>
              {tr("common.reload", "RELOAD")}
            </Button>
          </Tooltip>
          {/* A real browser, for a page that will not be framed. */}
          <LinkButton tiny href={live} target="_blank" rel="noreferrer">
            {tr("preview.open", "OPEN")}
          </LinkButton>
        </div>
      </TopStrip>
      <div className="previewframe">
        {live ? (
          <iframe
            key={`${live}#${nonce}`}
            ref={frame}
            src={live}
            aria-label={tr("preview.title", "preview")}
            /* Let the framed page do its thing, but keep it walled off from
               plxr — no access to this window, only its own. */
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        ) : (
          <div className="emptyNote">
            <b>{tr("preview.emptyHead", "nothing to show")}</b>
            {tr("preview.empty", "Type a URL, or open a port from PORTS.")}
          </div>
        )}
      </div>
    </div>
  );
}
