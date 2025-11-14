import React, { useMemo, useState } from "react";
import {
  Crown,
  Swords,
  Star,
  Puzzle,
  User,
  Shield,
  Palette,
} from "lucide-react";
import { motion } from "framer-motion";

// ============================
// THEME PALETTES
// ============================
type PaletteKey = "indigo" | "burgundy" | "jade";
type PaletteVars = Record<string, string>;

const PALETTES: Record<PaletteKey, { name: string; vars: PaletteVars }> = {
  indigo: {
    name: "Midnight Indigo",
    vars: {
      "--bg-1": "#0b1020",
      "--bg-2": "#0a0d18",
      "--bg-3": "#080a12",
      "--card": "#0b0f1aE6", // 90% opacity
      "--border": "#4453a3",
      "--stud": "#9fb1ff22",
      "--text": "#e8ecff",
      "--muted": "#9aa8d9",
      "--sep-from": "#3e4bb5",
      "--sep-via": "#b9c5ff",
      "--sep-to": "#3e4bb5",
      "--sq-light": "#1b2135",
      "--sq-dark": "#12182a",
      "--btn": "#0b0f1a",
      "--btn-hover": "#12182a",
    },
  },
  burgundy: {
    name: "Royal Burgundy",
    vars: {
      "--bg-1": "#2a0e12",
      "--bg-2": "#1f0b0e",
      "--bg-3": "#15080a",
      "--card": "#1c0f12E6",
      "--border": "#d4af37",
      "--stud": "#d4af371a",
      "--text": "#fff3e6",
      "--muted": "#f1cfb9",
      "--sep-from": "#b86d1b",
      "--sep-via": "#ffdca8",
      "--sep-to": "#b86d1b",
      "--sq-light": "#3b1d23",
      "--sq-dark": "#2a1318",
      "--btn": "#2a1215",
      "--btn-hover": "#33171a",
    },
  },
  jade: {
    name: "Forest Jade",
    vars: {
      "--bg-1": "#051612",
      "--bg-2": "#04110e",
      "--bg-3": "#03100d",
      "--card": "#0b1412E6",
      "--border": "#1ba27a",
      "--stud": "#85e2c31a",
      "--text": "#eafff9",
      "--muted": "#b1e7d7",
      "--sep-from": "#1b8a69",
      "--sep-via": "#b7f1e0",
      "--sep-to": "#1b8a69",
      "--sq-light": "#133a32",
      "--sq-dark": "#0e2a24",
      "--btn": "#0a1412",
      "--btn-hover": "#10201c",
    },
  },
};

// --- Minimal chessboard mock (design-only) ---
const initialPieces: Record<string, string> = {
  // White
  A2: "♙",
  B2: "♙",
  C2: "♙",
  D2: "♙",
  E2: "♙",
  F2: "♙",
  G2: "♙",
  H2: "♙",
  A1: "♖",
  B1: "♘",
  C1: "♗",
  D1: "♕",
  E1: "♔",
  F1: "♗",
  G1: "♘",
  H1: "♖",
  // Black
  A7: "♟",
  B7: "♟",
  C7: "♟",
  D7: "♟",
  E7: "♟",
  F7: "♟",
  G7: "♟",
  H7: "♟",
  A8: "♜",
  B8: "♞",
  C8: "♝",
  D8: "♛",
  E8: "♚",
  F8: "♝",
  G8: "♞",
  H8: "♜",
};

const files = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ranks = [8, 7, 6, 5, 4, 3, 2, 1];

// --- Ornate separators & frames ---
const Bar = () => (
  <div
    className="relative w-full h-[2px] my-3"
    style={{
      background:
        "linear-gradient(to right, var(--sep-from), var(--sep-via), var(--sep-to))",
    }}
  >
    <div
      className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full border shadow-[inset_0_0_8px_rgba(255,255,255,0.2)] flex items-center justify-center"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <span
        className="text-[10px] tracking-widest"
        style={{ color: "var(--text)" }}
      >
        †
      </span>
    </div>
  </div>
);

function OrnateCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={"relative rounded-2xl p-[1px] shadow-2xl " + className}
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.06))",
      }}
    >
      <div
        className="rounded-2xl h-full w-full backdrop-blur-sm border"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        {/* corner studs */}
        <div
          className="pointer-events-none absolute -top-1 -left-1 w-4 h-4 rounded-full border"
          style={{ background: "var(--stud)", borderColor: "var(--border)" }}
        />
        <div
          className="pointer-events-none absolute -top-1 -right-1 w-4 h-4 rounded-full border"
          style={{ background: "var(--stud)", borderColor: "var(--border)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-1 -left-1 w-4 h-4 rounded-full border"
          style={{ background: "var(--stud)", borderColor: "var(--border)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-1 -right-1 w-4 h-4 rounded-full border"
          style={{ background: "var(--stud)", borderColor: "var(--border)" }}
        />
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// --- Leather backdrop with theme variables ---
const Leather = ({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette: PaletteKey;
}) => {
  const vars = PALETTES[palette].vars as React.CSSProperties;
  return (
    <div
      className="min-h-screen w-full text-[var(--text)]"
      style={{
        ...vars,
        backgroundImage:
          "radial-gradient(circle at 30% 20%, var(--bg-1) 0%, var(--bg-2) 40%, var(--bg-3) 70%, var(--bg-3) 100%)",
      }}
    >
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 6px)",
        }}
      />
      {children}
    </div>
  );
};

// --- Nav ---
function Nav({
  palette,
  setPalette,
}: {
  palette: PaletteKey;
  setPalette: (v: PaletteKey) => void;
}) {
  const items = [
    { icon: <Swords size={18} />, label: "Play" },
    { icon: <Puzzle size={18} />, label: "Puzzles" },
    { icon: <Star size={18} />, label: "Leaderboards" },
    { icon: <Shield size={18} />, label: "Clubs" },
  ];
  return (
    <div
      className="flex items-center justify-between px-5 py-3 border-b bg-black/10 backdrop-blur-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2">
        <Crown style={{ color: "var(--text)" }} size={18} />
        <span className="font-black tracking-[0.25em] text-sm md:text-base select-none">
          CHESS†HOUSE
        </span>
      </div>
      <div className="hidden md:flex items-center gap-2">
        {items.map((it) => (
          <motion.button
            key={it.label}
            whileHover={{ y: -2 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-widest rounded-full"
            style={{ border: "1px solid var(--border)", background: "var(--btn)" }}
          >
            {it.icon}
            <span>{it.label}</span>
          </motion.button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Palette size={18} />
        </div>
        <select
          aria-label="Color Palette"
          className="text-sm rounded-full px-3 py-1.5 bg-transparent"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
          value={palette}
          onChange={(e) => setPalette(e.target.value as PaletteKey)}
        >
          {Object.entries(PALETTES).map(([k, v]) => (
            <option key={k} value={k} style={{ color: "black" }}>
              {v.name}
            </option>
          ))}
        </select>
        <motion.button
          whileTap={{ scale: 0.95 }}
          className="p-2 rounded-full"
          style={{ border: "1px solid var(--border)", background: "var(--btn)" }}
        >
          <User size={16} />
        </motion.button>
      </div>
    </div>
  );
}

// --- Board Square ---
function Square({
  file,
  rank,
  piece,
}: {
  file: string;
  rank: number;
  piece?: string;
}) {
  const isDark = (files.indexOf(file) + ranks.indexOf(rank)) % 2 === 1;
  return (
    <div
      className="relative aspect-square flex items-center justify-center select-none border"
      style={{
        background: isDark ? "var(--sq-dark)" : "var(--sq-light)",
        borderColor: "var(--border)",
        boxShadow: isDark
          ? "inset 0 0 12px rgba(255,255,255,0.03)"
          : "inset 0 0 12px rgba(255,255,255,0.08)",
      }}
    >
      {piece && (
        <span
          className="text-2xl md:text-3xl"
          style={{ textShadow: "0 1px 0 rgba(255,255,255,0.4)" }}
        >
          {piece}
        </span>
      )}
      <span className="absolute bottom-1 left-1 text-[10px] opacity-60">
        {file}
        {rank}
      </span>
    </div>
  );
}

// --- Board: exactly like reference (no weird max-width) ---
function Board() {
  return (
    <div
      className="grid grid-cols-8 overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)" }}
    >
      {ranks.map((r) =>
        files.map((f) => {
          const key = `${f}${r}`;
          return (
            <Square
              key={key}
              file={f}
              rank={r as number}
              piece={initialPieces[key]}
            />
          );
        })
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 text-xs border-b"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      <span className="tracking-widest uppercase">{k}</span>
      <span className="font-semibold" style={{ color: "var(--text)" }}>
        {v}
      </span>
    </div>
  );
}

function PuzzlePanel() {
  const [revealed, setRevealed] = useState(false);
  return (
    <OrnateCard>
      <div className="flex items-center gap-2 mb-2">
        <Puzzle size={16} />
        <h3 className="font-semibold tracking-widest uppercase">
          Daily Puzzle
        </h3>
      </div>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        White to move • Mate in 2
      </p>
      <Bar />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat k="Elo" v="1750" />
        <Stat k="Theme" v="Smothered Mate" />
        <Stat k="Tries" v="2" />
        <Stat k="Time" v="00:42" />
      </div>
      <div className="mt-3">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => setRevealed((s) => !s)}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-full tracking-widest uppercase text-[11px]"
          style={{ border: "1px solid var(--border)", background: "var(--btn)" }}
        >
          {revealed ? "Hide Solution" : "Reveal Solution"}
        </motion.button>
      </div>
      {revealed && (
        <div className="mt-3 text-sm leading-relaxed">
          <p>1. Qg8+ Rxg8 2. Nf7#</p>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            † Engraved Note: classic ladder motif into a smothered mate
            aesthetic.
          </p>
        </div>
      )}
    </OrnateCard>
  );
}

function Hero() {
  return (
    <div className="text-center py-8">
      <div
        className="flex items-center justify-center gap-3"
        style={{ color: "var(--muted)" }}
      >
        <span className="text-xs tracking-[0.5em] uppercase">
          Gothic Edition
        </span>
        <span>•</span>
        <span className="text-xs tracking-[0.5em] uppercase">
          Colorful Chrome Aesthetic
        </span>
      </div>
      <h1 className="mt-3 text-3xl md:text-5xl font-black tracking-[0.12em]">
        CHECKMATE IN <span className="inline-block -skew-x-6">COLOR</span>
      </h1>
      <p
        className="mt-3 max-w-xl mx-auto text-sm"
        style={{ color: "var(--muted)" }}
      >
        Luxe cards, engraved frames—now with rich palettes (no stark black &
        white).
      </p>
      <div className="mt-4 flex items-center justify-center gap-3">
        <motion.button
          whileHover={{ y: -2 }}
          className="px-4 py-2 rounded-full uppercase tracking-widest text-xs inline-flex items-center gap-2"
          style={{ border: "1px solid var(--border)", background: "var(--btn)" }}
        >
          <Swords size={16} /> Play Now
        </motion.button>
        <motion.button
          whileHover={{ y: -2 }}
          className="px-4 py-2 rounded-full uppercase tracking-widest text-xs inline-flex items-center gap-2"
          style={{
            border: "1px solid var(--border)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.12))",
          }}
        >
          <Puzzle size={16} /> Puzzles
        </motion.button>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div
      className="mt-8 py-6 text-center text-xs"
      style={{ color: "var(--muted)" }}
    >
      <div className="flex items-center justify-center gap-6 mb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} className="opacity-80">
            †
          </span>
        ))}
      </div>
      <div className="tracking-[0.35em] uppercase">
        © Chess†House — Crafted in Color
      </div>
    </div>
  );
}

export default function ChromeHeartsChessUI() {
  const [palette, setPalette] = useState<PaletteKey>("indigo");

  const side = useMemo(
    () => (
      <div className="space-y-4">
        <OrnateCard>
          <div className="flex items-center gap-2 mb-1">
            <Star size={16} />
            <h3 className="font-semibold tracking-widest uppercase">
              Featured Arena
            </h3>
          </div>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            “Midnight Silver Open” starts in 02:15:44
          </p>
          <Bar />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat k="Registered" v="128" />
            <Stat k="Format" v="3+2 Blitz" />
            <Stat k="Rounds" v="9" />
            <Stat k="Prizes" v="Top 3" />
          </div>
          <div className="mt-3">
            <motion.button
              whileTap={{ scale: 0.98 }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-full tracking-widest uppercase text-[11px]"
              style={{
                border: "1px solid var(--border)",
                background: "var(--btn)",
              }}
            >
              Join Arena
            </motion.button>
          </div>
        </OrnateCard>
        <PuzzlePanel />
      </div>
    ),
    []
  );

  return (
    <Leather palette={palette}>
      <div className="max-w-6xl mx-auto">
        <Nav palette={palette} setPalette={setPalette} />
        <Hero />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-4 md:px-6">
          <div className="lg:col-span-2">
            <OrnateCard>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Crown size={16} />
                  <h3 className="font-semibold tracking-widest uppercase">
                    Table
                  </h3>
                </div>
                <div
                  className="text-xs tracking-widest uppercase"
                  style={{ color: "var(--muted)" }}
                >
                  Color Edition
                </div>
              </div>
              <Board />
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  className="px-3 py-2 rounded-full"
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--btn)",
                  }}
                >
                  New Game
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  className="px-3 py-2 rounded-full"
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--btn)",
                  }}
                >
                  Undo
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  className="px-3 py-2 rounded-full"
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--btn)",
                  }}
                >
                  Flip
                </motion.button>
              </div>
            </OrnateCard>
          </div>
          <div>{side}</div>
        </div>
        <Footer />
      </div>
    </Leather>
  );
}
