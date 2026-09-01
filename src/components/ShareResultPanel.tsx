import { useEffect, useMemo, useRef, useState } from "react";
import type { GameStats } from "./GameScreen";
import { sfxSelect, sfxUI } from "../lib/audio";
import {
  buildFullCaption,
  buildShareCaption,
  buildShareStats,
  buildTweetIntentUrl,
  type ShareLang,
} from "../lib/shareText";
import { renderShareCard } from "../lib/shareCard";
import {
  copyImageAndText,
  copyText,
  downloadBlob,
  isWebShareAvailable,
  openTweetIntent,
  webShare,
} from "../lib/shareActions";

type Props = {
  stats: GameStats;
  isBest: boolean;
  prevBest: number;
  bestDiff: number;
  rank: { label: string; color: string; title: string };
  rankInfo: { rank: number; total: number } | null;
};

const STATUS_MS = 2800;

export default function ShareResultPanel({ stats, isBest, prevBest, bestDiff, rank, rankInfo }: Props) {
  const [lang, setLang] = useState<ShareLang>("ja");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [cardFailed, setCardFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const statusTimer = useRef<number | null>(null);
  const imgUrlRef = useRef<string | null>(null);

  // Everything the caption/card builders need, resolved once per run+reveal
  // (rankInfo/isBest/prevBest never change after mount) so every button
  // below describes the exact same result regardless of click order.
  const shareStats = useMemo(
    () => buildShareStats({ stats, rankLabel: rank.label, rankTitle: rank.title, rankColor: rank.color, isNewRecord: isBest, prevBest, bestDiff, rankInfo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Whether this device's share sheet can actually take a file attachment --
  // decides whether the "OTHER APPS" button (Web Share API) is worth
  // showing at all. Probed once with a throwaway File, independent of the
  // real card image.
  useEffect(() => {
    try {
      const probe = new File([""], "probe.png", { type: "image/png" });
      setCanShareFiles(isWebShareAvailable() && !!navigator.canShare && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  // (Re)generate the card image whenever the caption language changes.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setCardFailed(false);
    renderShareCard(shareStats, lang)
      .then((b) => {
        if (cancelled) return;
        setBlob(b);
        const url = URL.createObjectURL(b);
        if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current);
        imgUrlRef.current = url;
        setImgUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCardFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareStats, lang]);

  useEffect(
    () => () => {
      if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current);
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
    },
    [],
  );

  const showStatus = (msg: string) => {
    setStatus(msg);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), STATUS_MS);
  };

  const t = (ja: string, en: string) => (lang === "ja" ? ja : en);

  const handleX = async () => {
    sfxUI();
    openTweetIntent(buildTweetIntentUrl(shareStats, lang));
    if (!blob) {
      showStatus(t("画像なしで投稿画面を開きました", "Opened the post composer without an image"));
      return;
    }
    const outcome = await copyImageAndText(blob, buildFullCaption(shareStats, lang), `suusoku-result-${lang}.png`);
    if (outcome.kind === "copied-image-and-text") {
      showStatus(t("画像をコピーしました。投稿画面に貼り付け(Ctrl+V)してください", "Image copied — paste it (Ctrl+V) into the post"));
    } else {
      showStatus(t("画像を保存しました。投稿に添付してください", "Image saved — attach it to your post"));
    }
  };

  const handleDiscord = async () => {
    sfxUI();
    if (!blob) {
      showStatus(t("画像の準備ができていません", "Image isn't ready yet"));
      return;
    }
    const outcome = await copyImageAndText(blob, buildFullCaption(shareStats, lang), `suusoku-result-${lang}.png`);
    if (outcome.kind === "copied-image-and-text") {
      showStatus(t("コピーしました。Discordに貼り付け(Ctrl+V)してください", "Copied — paste it (Ctrl+V) into Discord"));
    } else {
      showStatus(t("画像を保存しました。Discordにドラッグ＆ドロップしてください", "Image saved — drag it into Discord"));
    }
  };

  const handleNativeShare = async () => {
    sfxUI();
    const { body, hashtags, url } = buildShareCaption(shareStats, lang);
    const file = blob ? new File([blob], `suusoku-result-${lang}.png`, { type: "image/png" }) : undefined;
    const outcome = await webShare(`${body}\n${hashtags}`, url, file);
    if (outcome.kind === "unsupported") showStatus(t("この端末では利用できません", "Not available on this device"));
  };

  const handleSaveImage = () => {
    sfxUI();
    if (!blob) {
      showStatus(t("画像の準備ができていません", "Image isn't ready yet"));
      return;
    }
    downloadBlob(blob, `suusoku-result-${lang}.png`);
    showStatus(t("画像を保存しました", "Image saved"));
  };

  const handleCopyText = async () => {
    sfxUI();
    const ok = await copyText(buildFullCaption(shareStats, lang));
    showStatus(ok ? t("テキストをコピーしました", "Text copied") : t("コピーに失敗しました", "Copy failed"));
  };

  const langBtn = (l: ShareLang, label: string) => (
    <button
      onClick={() => {
        if (l !== lang) {
          sfxSelect();
          setLang(l);
        }
      }}
      className={`clip-chip border px-3 py-1 font-mono2 text-[10px] tracking-[0.15em] transition-colors ${
        lang === l ? "border-cyan-300 bg-cyan-400/20 text-cyan-100" : "border-white/20 bg-white/5 text-white/50 hover:text-white/80"
      }`}
    >
      {label}
    </button>
  );

  const actionBtn = (opts: { onClick: () => void; label: string; border: string; text: string; disabled?: boolean }) => (
    <button
      onClick={opts.onClick}
      disabled={opts.disabled}
      className={`clip-chip border ${opts.border} bg-black/40 px-3 py-2.5 font-display text-xs font-black tracking-[0.1em] ${opts.text} transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {opts.label}
    </button>
  );

  return (
    <div
      className="clip-panel mt-6 w-full max-w-xl border border-cyan-400/25 bg-black/50 px-5 py-4 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/70">
          {t("結果をシェア", "SHARE RESULT")}
        </span>
        <div className="flex gap-1.5">
          {langBtn("ja", "日本語")}
          {langBtn("en", "EN")}
        </div>
      </div>

      <div className="mt-3 aspect-[1200/630] w-full overflow-hidden rounded border border-white/10 bg-black/60">
        {imgUrl ? (
          <img src={imgUrl} alt={t("結果カードのプレビュー", "Result card preview")} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center font-mono2 text-[10px] tracking-widest text-white/30">
            {cardFailed ? t("画像を生成できませんでした", "Couldn't generate the image") : busy ? t("生成中…", "Generating…") : ""}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {actionBtn({ onClick: handleX, label: "X", border: "border-white/35", text: "text-white", disabled: busy })}
        {actionBtn({
          onClick: handleDiscord,
          label: "Discord",
          border: "border-[#5865F2]/60",
          text: "text-[#a3b1ff]",
          disabled: busy,
        })}
        {canShareFiles &&
          actionBtn({
            onClick: handleNativeShare,
            label: t("その他", "OTHER"),
            border: "border-cyan-400/40",
            text: "text-cyan-200",
          })}
        {actionBtn({
          onClick: handleSaveImage,
          label: t("画像保存", "SAVE"),
          border: "border-white/20",
          text: "text-white/70",
          disabled: busy,
        })}
        <button
          onClick={handleCopyText}
          className="clip-chip col-span-2 border border-white/20 bg-black/40 px-3 py-2.5 font-mono2 text-[10px] tracking-[0.2em] text-white/60 transition-colors hover:bg-white/10 sm:col-span-4"
        >
          {t("テキストだけコピー", "COPY TEXT ONLY")}
        </button>
      </div>

      {status && (
        <div className="mt-2.5 text-center font-mono2 text-[10px] tracking-wider text-cyan-200/85">{status}</div>
      )}
    </div>
  );
}
