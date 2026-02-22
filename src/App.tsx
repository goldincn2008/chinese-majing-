/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  RotateCcw, 
  User, 
  Cpu, 
  Info, 
  ChevronRight,
  History,
  Settings,
  X,
  Volume2,
  VolumeX
} from 'lucide-react';

// --- Constants & Types ---

type Suit = 'Wan' | 'Tiao' | 'Tong' | 'Wind' | 'Dragon';
type TileId = string;

interface Tile {
  id: TileId;
  suit: Suit;
  value: number; // 1-9 for suits, 1-4 for Wind (ESWN), 1-3 for Dragon (ZFB)
  name: string;
}

type PlayerPosition = 0 | 1 | 2 | 3; // 0: Player, 1: Right, 2: Top, 3: Left

interface Meld {
  type: 'Chow' | 'Pung' | 'Kong' | 'AnKong';
  tiles: Tile[];
  fromPlayer?: PlayerPosition;
}

interface PlayerState {
  id: PlayerPosition;
  name: string;
  isAI: boolean;
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  score: number;
  isDealer: boolean;
}

interface GameState {
  deck: Tile[];
  players: PlayerState[];
  currentTurn: PlayerPosition;
  lastDiscard: { tile: Tile; player: PlayerPosition } | null;
  phase: 'Dealing' | 'Playing' | 'ActionWindow' | 'GameOver';
  winner: PlayerPosition | null;
  winType: 'SelfDraw' | 'Discard' | null;
  logs: string[];
  wallCount: number;
}

const SUITS: Suit[] = ['Wan', 'Tiao', 'Tong'];
const WINDS = ['东', '南', '西', '北'];
const DRAGONS = ['中', '发', '白'];

const createDeck = (): Tile[] => {
  const deck: Tile[] = [];
  let idCounter = 0;

  // Suits: 1-9, 4 of each
  SUITS.forEach(suit => {
    for (let v = 1; v <= 9; v++) {
      for (let i = 0; i < 4; i++) {
        deck.push({ id: `tile-${idCounter++}`, suit, value: v, name: `${v}${suit === 'Wan' ? '万' : suit === 'Tiao' ? '条' : '筒'}` });
      }
    }
  });

  // Winds: 4 of each
  WINDS.forEach((name, v) => {
    for (let i = 0; i < 4; i++) {
      deck.push({ id: `tile-${idCounter++}`, suit: 'Wind', value: v + 1, name });
    }
  });

  // Dragons: 4 of each
  DRAGONS.forEach((name, v) => {
    for (let i = 0; i < 4; i++) {
      deck.push({ id: `tile-${idCounter++}`, suit: 'Dragon', value: v + 1, name });
    }
  });

  return deck;
};

const shuffle = (array: any[]) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// --- Mahjong Logic Utilities ---

const sortHand = (hand: Tile[]) => {
  const suitOrder: Record<Suit, number> = { 'Wan': 0, 'Tong': 1, 'Tiao': 2, 'Wind': 3, 'Dragon': 4 };
  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.value - b.value;
  });
};

const isSameTile = (a: Tile, b: Tile) => a.suit === b.suit && a.value === b.value;

const canHu = (hand: Tile[], melds: Meld[]): boolean => {
  const allTiles = [...hand];
  if (allTiles.length % 3 !== 2) return false;

  const counts: Record<string, number> = {};
  allTiles.forEach(t => {
    const key = `${t.suit}-${t.value}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const checkStandard = (remainingCounts: Record<string, number>, meldsNeeded: number): boolean => {
    const keys = Object.keys(remainingCounts).filter(k => remainingCounts[k] > 0).sort();
    if (keys.length === 0) return meldsNeeded === 0;

    const firstKey = keys[0];
    
    // Try Triplet
    if (remainingCounts[firstKey] >= 3) {
      const nextCounts = { ...remainingCounts, [firstKey]: remainingCounts[firstKey] - 3 };
      if (checkStandard(nextCounts, meldsNeeded - 1)) return true;
    }

    // Try Sequence (only for suits)
    const [suit, valStr] = firstKey.split('-');
    const val = parseInt(valStr);
    if (['Wan', 'Tiao', 'Tong'].includes(suit) && val <= 7) {
      const key2 = `${suit}-${val + 1}`;
      const key3 = `${suit}-${val + 2}`;
      if (remainingCounts[key2] > 0 && remainingCounts[key3] > 0) {
        const nextCounts = { 
          ...remainingCounts, 
          [firstKey]: remainingCounts[firstKey] - 1,
          [key2]: remainingCounts[key2] - 1,
          [key3]: remainingCounts[key3] - 1
        };
        if (checkStandard(nextCounts, meldsNeeded - 1)) return true;
      }
    }

    return false;
  };

  // Try every possible pair
  const keys = Object.keys(counts);
  for (const key of keys) {
    if (counts[key] >= 2) {
      const remaining = { ...counts, [key]: counts[key] - 2 };
      if (checkStandard(remaining, (allTiles.length - 2) / 3)) return true;
    }
  }

  return false;
};

// --- Components ---

interface TileViewProps {
  tile?: Tile;
  hidden?: boolean;
  onClick?: () => void;
  active?: boolean;
  small?: boolean;
  vertical?: boolean;
  discarded?: boolean;
}

const TileView: React.FC<TileViewProps> = ({ 
  tile, 
  hidden = false, 
  onClick, 
  active = false, 
  small = false,
  vertical = false,
  discarded = false
}) => {
  const baseClass = `
    relative flex items-center justify-center rounded-sm transition-all duration-200 cursor-pointer
    ${small ? 'w-8 h-11' : 'w-12 h-16'}
    ${hidden ? 'bg-emerald-700 border-2 border-emerald-800' : 'bg-linear-to-br from-white to-gray-100 text-gray-900 border border-gray-300 tile-shadow'}
    ${active ? 'tile-active' : ''}
    ${discarded ? 'tile-discarded opacity-90' : ''}
    ${vertical ? 'rotate-90' : ''}
  `;

  if (hidden) return <div className={baseClass} onClick={onClick} />;

  const renderPattern = () => {
    if (!tile) return null;
    const { suit, value } = tile;

    const Dot = ({ color = 'bg-blue-600', s = 'w-2 h-2', ...props }: { color?: string, s?: string, key?: any }) => (
      <div 
        {...props} 
        className={`${s} rounded-full ${color} shadow-[inset_-1px_-1px_2px_rgba(0,0,0,0.3),1px_1px_2px_rgba(255,255,255,0.5)] relative overflow-hidden`}
      >
        <div className="absolute top-0.5 left-0.5 w-1/3 h-1/3 bg-white/40 rounded-full blur-[1px]" />
      </div>
    );

    const Stick = ({ color = 'bg-green-600', s = 'w-1.5 h-4', ...props }: { color?: string, s?: string, key?: any }) => (
      <div 
        {...props} 
        className={`${s} rounded-full ${color} shadow-[inset_-1px_-1px_2px_rgba(0,0,0,0.3),1px_1px_2px_rgba(255,255,255,0.4)] relative overflow-hidden`}
      >
        <div className="absolute top-0 left-0.5 w-[20%] h-full bg-white/20 blur-[0.5px]" />
      </div>
    );

    if (suit === 'Tong') {
      const layouts: Record<number, string> = {
        1: "flex items-center justify-center",
        2: "flex flex-col justify-around h-full",
        3: "flex flex-col justify-around h-full items-center -rotate-45",
        4: "grid grid-cols-2 gap-2 p-1",
        5: "grid grid-cols-2 gap-2 p-1 relative",
        6: "grid grid-cols-2 gap-x-2 gap-y-1 p-1",
        7: "grid grid-cols-2 gap-x-2 gap-y-1 p-1 relative",
        8: "grid grid-cols-2 gap-x-2 gap-y-1 p-1",
        9: "grid grid-cols-3 gap-1 p-1"
      };

      const colors = ['bg-blue-600', 'bg-green-600', 'bg-red-600'];

      return (
        <div className={`w-full h-full ${layouts[value]}`}>
          {value === 5 ? (
            <>
              <Dot color={colors[0]} /> <Dot color={colors[1]} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Dot color={colors[2]} />
              </div>
              <Dot color={colors[1]} /> <Dot color={colors[0]} />
            </>
          ) : value === 7 ? (
            <>
              <div className="absolute top-1 left-1/2 -translate-x-1/2">
                <Dot color={colors[2]} s="w-2 h-2" />
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Dot key={i} color={colors[i % 2]} s="w-1.5 h-1.5" />
                ))}
              </div>
            </>
          ) : (
            Array.from({ length: value }).map((_, i) => (
              <Dot key={i} color={colors[i % 3]} s={value === 1 ? 'w-6 h-6' : value > 6 ? 'w-1.5 h-1.5' : 'w-2 h-2'} />
            ))
          )}
        </div>
      );
    }

    if (suit === 'Tiao') {
      const layouts: Record<number, string> = {
        1: "flex items-center justify-center",
        2: "flex flex-col justify-around h-full",
        3: "flex flex-col items-center justify-around h-full",
        4: "grid grid-cols-2 gap-x-3 gap-y-2 p-1",
        5: "grid grid-cols-2 gap-x-3 gap-y-2 p-1 relative",
        6: "grid grid-cols-2 gap-x-3 gap-y-1 p-1",
        7: "grid grid-cols-2 gap-x-3 gap-y-1 p-1 relative",
        8: "grid grid-cols-2 gap-x-3 gap-y-1 p-1",
        9: "grid grid-cols-3 gap-1 p-1"
      };

      const colors = ['bg-green-600', 'bg-red-600', 'bg-blue-600'];

      return (
        <div className={`w-full h-full ${layouts[value]}`}>
          {value === 1 ? (
            <Stick color="bg-green-700" s="w-3 h-10" />
          ) : value === 3 ? (
            <>
              <Stick color={colors[0]} />
              <div className="flex gap-2">
                <Stick color={colors[1]} />
                <Stick color={colors[2]} />
              </div>
            </>
          ) : value === 5 ? (
            <>
              <Stick color={colors[0]} /> <Stick color={colors[1]} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Stick color={colors[2]} />
              </div>
              <Stick color={colors[1]} /> <Stick color={colors[0]} />
            </>
          ) : value === 7 ? (
            <>
              <div className="absolute top-1 left-1/2 -translate-x-1/2">
                <Stick color={colors[0]} />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Stick key={i} color={colors[(i + 1) % 3]} />
                ))}
              </div>
            </>
          ) : (
            Array.from({ length: value }).map((_, i) => (
              <Stick key={i} color={colors[i % 3]} />
            ))
          )}
        </div>
      );
    }

    if (suit === 'Wan') {
      return (
        <div className="flex flex-col items-center leading-none">
          <span className="text-red-600 font-black text-xs">{value}</span>
          <span className="text-red-700 font-serif text-xl">万</span>
        </div>
      );
    }

    if (suit === 'Wind') {
      const colors = ['text-blue-800', 'text-red-800', 'text-green-800', 'text-orange-800'];
      return (
        <span className={`${colors[value - 1]} font-serif font-black text-2xl`}>
          {WINDS[value - 1]}
        </span>
      );
    }

    if (suit === 'Dragon') {
      const colors = ['text-red-600', 'text-green-600', 'text-blue-400'];
      return (
        <span className={`${colors[value - 1]} font-serif font-black text-2xl`}>
          {DRAGONS[value - 1]}
        </span>
      );
    }

    return <span className="text-sm">{tile.name}</span>;
  };

  return (
    <motion.div 
      whileHover={!discarded ? { scale: 1.05, y: -5 } : {}}
      className={baseClass}
      onClick={onClick}
    >
      <div className="flex items-center justify-center w-full h-full p-1">
        {renderPattern()}
      </div>
      {!small && (
        <div className="absolute top-0.5 left-1 text-[8px] opacity-20 font-mono">
          {tile!.suit[0]}{tile!.value}
        </div>
      )}
    </motion.div>
  );
};

export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<{ player: PlayerPosition, actions: string[] }[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  // --- Game Initialization ---

  const initGame = useCallback(() => {
    const deck = shuffle(createDeck());
    const players: PlayerState[] = [
      { id: 0, name: '你', isAI: false, hand: [], melds: [], discards: [], score: 100, isDealer: true },
      { id: 1, name: 'AI 东', isAI: true, hand: [], melds: [], discards: [], score: 100, isDealer: false },
      { id: 2, name: 'AI 南', isAI: true, hand: [], melds: [], discards: [], score: 100, isDealer: false },
      { id: 3, name: 'AI 西', isAI: true, hand: [], melds: [], discards: [], score: 100, isDealer: false },
    ];

    // Deal 13 cards each
    for (let i = 0; i < 13; i++) {
      players.forEach(p => p.hand.push(deck.pop()!));
    }
    
    // Dealer draws 14th
    players[0].hand.push(deck.pop()!);
    players.forEach(p => p.hand = sortHand(p.hand));

    setGame({
      deck,
      players,
      currentTurn: 0,
      lastDiscard: null,
      phase: 'Playing',
      winner: null,
      winType: null,
      logs: ['游戏开始，你是庄家。'],
      wallCount: deck.length
    });
    setSelectedTileId(null);
    setPendingActions([]);
  }, []);

  useEffect(() => {
    initGame();
  }, [initGame]);

  // --- Game Actions ---

  const addLog = (msg: string) => {
    setGame(prev => prev ? { ...prev, logs: [msg, ...prev.logs].slice(0, 50) } : null);
  };

  const handleDiscard = (playerId: PlayerPosition, tileId: string) => {
    if (!game || game.phase !== 'Playing') return;

    const player = game.players[playerId];
    const tileIndex = player.hand.findIndex(t => t.id === tileId);
    if (tileIndex === -1) return;

    const tile = player.hand[tileIndex];
    const newHand = [...player.hand];
    newHand.splice(tileIndex, 1);

    const newPlayers = [...game.players];
    newPlayers[playerId] = {
      ...player,
      hand: sortHand(newHand),
      discards: [...player.discards, tile]
    };

    setGame(prev => prev ? {
      ...prev,
      players: newPlayers,
      lastDiscard: { tile, player: playerId },
      phase: 'ActionWindow'
    } : null);

    addLog(`${player.name} 打出了 ${tile.name}`);
    checkResponseActions(tile, playerId);
  };

  const checkResponseActions = (tile: Tile, fromPlayer: PlayerPosition) => {
    const actions: { player: PlayerPosition, actions: string[] }[] = [];

    game?.players.forEach(p => {
      if (p.id === fromPlayer) return;

      const possible: string[] = [];
      
      // Check Hu
      if (canHu([...p.hand, tile], p.melds)) possible.push('胡');
      
      // Check Pung
      const sameCount = p.hand.filter(t => isSameTile(t, tile)).length;
      if (sameCount >= 2) possible.push('碰');
      if (sameCount === 3) possible.push('杠');

      // Check Chow (only next player)
      if ((fromPlayer + 1) % 4 === p.id && ['Wan', 'Tiao', 'Tong'].includes(tile.suit)) {
        const has = (v: number) => p.hand.some(t => t.suit === tile.suit && t.value === v);
        if (has(tile.value - 2) && has(tile.value - 1)) possible.push('吃');
        if (has(tile.value - 1) && has(tile.value + 1)) possible.push('吃');
        if (has(tile.value + 1) && has(tile.value + 2)) possible.push('吃');
      }

      if (possible.length > 0) {
        actions.push({ player: p.id as PlayerPosition, actions: possible });
      }
    });

    if (actions.length === 0) {
      // No one can act, next player's turn
      setTimeout(() => nextTurn((fromPlayer + 1) % 4 as PlayerPosition), 500);
    } else {
      setPendingActions(actions);
    }
  };

  const nextTurn = (playerId: PlayerPosition) => {
    setGame(prev => {
      if (!prev) return null;
      if (prev.deck.length === 0) {
        return { ...prev, phase: 'GameOver', winner: null, logs: ['流局！牌墙已空。', ...prev.logs] };
      }

      const newDeck = [...prev.deck];
      const drawnTile = newDeck.pop()!;
      const newPlayers = [...prev.players];
      newPlayers[playerId] = {
        ...newPlayers[playerId],
        hand: sortHand([...newPlayers[playerId].hand, drawnTile])
      };

      return {
        ...prev,
        deck: newDeck,
        players: newPlayers,
        currentTurn: playerId,
        phase: 'Playing',
        lastDiscard: null,
        wallCount: newDeck.length
      };
    });
    setPendingActions([]);
  };

  const performAction = (playerId: PlayerPosition, action: string) => {
    if (!game || !game.lastDiscard) return;
    const { tile, player: fromPlayer } = game.lastDiscard;

    setGame(prev => {
      if (!prev) return null;
      const newPlayers = [...prev.players];
      const actor = newPlayers[playerId];
      const target = newPlayers[fromPlayer];

      if (action === '胡') {
        return { 
          ...prev, 
          phase: 'GameOver', 
          winner: playerId, 
          winType: 'Discard',
          logs: [`${actor.name} 胡牌了！点炮者：${target.name}`, ...prev.logs]
        };
      }

      if (action === '碰' || action === '杠' || action === '吃') {
        // Remove tiles from hand
        let tilesToMeld: Tile[] = [tile];
        let newHand = [...actor.hand];

        if (action === '碰') {
          const indices = newHand.reduce((acc, t, i) => isSameTile(t, tile) ? [...acc, i] : acc, [] as number[]).slice(0, 2);
          indices.reverse().forEach(i => tilesToMeld.push(newHand.splice(i, 1)[0]));
        } else if (action === '杠') {
          const indices = newHand.reduce((acc, t, i) => isSameTile(t, tile) ? [...acc, i] : acc, [] as number[]);
          indices.reverse().forEach(i => tilesToMeld.push(newHand.splice(i, 1)[0]));
        } else if (action === '吃') {
          // Simplified: just pick the first valid sequence
          const v = tile.value;
          const s = tile.suit;
          const findAndRemove = (val: number) => {
            const idx = newHand.findIndex(t => t.suit === s && t.value === val);
            if (idx !== -1) tilesToMeld.push(newHand.splice(idx, 1)[0]);
          };
          if (newHand.some(t => t.suit === s && t.value === v-2) && newHand.some(t => t.suit === s && t.value === v-1)) {
            findAndRemove(v-2); findAndRemove(v-1);
          } else if (newHand.some(t => t.suit === s && t.value === v-1) && newHand.some(t => t.suit === s && t.value === v+1)) {
            findAndRemove(v-1); findAndRemove(v+1);
          } else {
            findAndRemove(v+1); findAndRemove(v+2);
          }
        }

        newPlayers[playerId] = {
          ...actor,
          hand: sortHand(newHand),
          melds: [...actor.melds, { type: action as any, tiles: tilesToMeld, fromPlayer }]
        };

        // Remove from target's discards
        newPlayers[fromPlayer] = {
          ...target,
          discards: target.discards.slice(0, -1)
        };

        return {
          ...prev,
          players: newPlayers,
          currentTurn: playerId,
          phase: 'Playing',
          lastDiscard: null,
          logs: [`${actor.name} ${action}了 ${tile.name}`, ...prev.logs]
        };
      }

      return prev;
    });

    setPendingActions([]);
    if (action === '杠') {
      // Kong gets a replacement tile
      setTimeout(() => {
        setGame(prev => {
          if (!prev) return null;
          const newDeck = [...prev.deck];
          const drawn = newDeck.pop()!;
          const newPlayers = [...prev.players];
          newPlayers[playerId].hand = sortHand([...newPlayers[playerId].hand, drawn]);
          return { ...prev, deck: newDeck, players: newPlayers, wallCount: newDeck.length };
        });
      }, 500);
    }
  };

  // --- AI Logic ---

  useEffect(() => {
    if (!game || game.phase === 'GameOver') return;

    const currentPlayer = game.players[game.currentTurn];
    
    // AI Turn
    if (game.phase === 'Playing' && currentPlayer.isAI) {
      const timer = setTimeout(() => {
        // Check for Hu first
        if (canHu(currentPlayer.hand, currentPlayer.melds)) {
          setGame(prev => prev ? { ...prev, phase: 'GameOver', winner: game.currentTurn, winType: 'SelfDraw', logs: [`${currentPlayer.name} 自摸胡牌！`, ...prev.logs] } : null);
          return;
        }

        // Simple Discard Strategy: Discard isolated tiles or winds/dragons
        const hand = currentPlayer.hand;
        let discardIndex = -1;

        // 1. Find isolated winds/dragons
        discardIndex = hand.findIndex(t => (t.suit === 'Wind' || t.suit === 'Dragon') && hand.filter(h => isSameTile(h, t)).length === 1);
        
        // 2. Find isolated suit tiles (no neighbors)
        if (discardIndex === -1) {
          discardIndex = hand.findIndex(t => {
            if (t.suit === 'Wind' || t.suit === 'Dragon') return false;
            const hasNeighbor = hand.some(h => h.suit === t.suit && Math.abs(h.value - t.value) <= 1);
            return !hasNeighbor;
          });
        }

        // 3. Just discard the first tile if nothing else
        if (discardIndex === -1) discardIndex = 0;

        handleDiscard(game.currentTurn, hand[discardIndex].id);
      }, 1500);
      return () => clearTimeout(timer);
    }

    // AI Response Action
    if (game.phase === 'ActionWindow') {
      const aiActions = pendingActions.filter(a => game.players[a.player].isAI);
      if (aiActions.length > 0) {
        const timer = setTimeout(() => {
          // AI Priority: Hu > Kong > Pung > Chow
          const bestAction = aiActions[0];
          if (bestAction.actions.includes('胡')) performAction(bestAction.player, '胡');
          else if (bestAction.actions.includes('杠')) performAction(bestAction.player, '杠');
          else if (bestAction.actions.includes('碰')) performAction(bestAction.player, '碰');
          else if (bestAction.actions.includes('吃')) performAction(bestAction.player, '吃');
          else {
            // AI Passes
            setPendingActions(prev => prev.filter(p => p.player !== bestAction.player));
            if (pendingActions.length === 1) {
              setTimeout(() => nextTurn((game.lastDiscard!.player + 1) % 4 as PlayerPosition), 500);
            }
          }
        }, 1000);
        return () => clearTimeout(timer);
      } else if (pendingActions.length > 0 && !pendingActions.some(a => !game.players[a.player].isAI)) {
          // Only AI left and they all passed or handled above
      }
    }
  }, [game?.phase, game?.currentTurn, pendingActions]);

  // --- Render Helpers ---

  if (!game) return null;

  const player = game.players[0];
  const aiPlayers = [game.players[1], game.players[2], game.players[3]];

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center p-4 overflow-hidden font-sans">
      
      {/* Header Info */}
      <div className="absolute top-4 left-4 flex items-center gap-4 bg-black/40 backdrop-blur-md p-3 rounded-2xl border border-white/10">
        <div className="flex flex-col">
          <span className="text-xs text-emerald-300 font-bold uppercase tracking-wider">牌墙剩余</span>
          <span className="text-2xl font-mono font-bold">{game.wallCount}</span>
        </div>
        <div className="h-8 w-px bg-white/10" />
        <div className="flex flex-col">
          <span className="text-xs text-emerald-300 font-bold uppercase tracking-wider">当前回合</span>
          <span className="text-sm font-medium">{game.players[game.currentTurn].name}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
        <button 
          onClick={() => {
            if (audioRef.current) {
              if (isMusicPlaying) {
                audioRef.current.pause();
              } else {
                audioRef.current.play().catch(e => console.log("Autoplay blocked", e));
              }
              setIsMusicPlaying(!isMusicPlaying);
            }
          }}
          className={`p-3 bg-black/40 hover:bg-black/60 rounded-full border border-white/10 transition-all ${isMusicPlaying ? 'text-yellow-400' : 'text-white'}`}
          title={isMusicPlaying ? "关闭音乐" : "播放音乐"}
        >
          {isMusicPlaying ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <button 
          onClick={() => setShowLogs(!showLogs)}
          className="p-3 bg-black/40 hover:bg-black/60 rounded-full border border-white/10 transition-all"
        >
          <History size={20} />
        </button>
        <button 
          onClick={initGame}
          className="p-3 bg-black/40 hover:bg-black/60 rounded-full border border-white/10 transition-all"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      {/* Game Table */}
      <div className="relative w-full max-w-5xl aspect-square md:aspect-video bg-emerald-900/50 rounded-[40px] border-8 border-emerald-800 shadow-2xl flex items-center justify-center overflow-hidden">
        
        {/* Discard Piles (Center) */}
        <div className="grid grid-cols-2 gap-8 p-8 max-w-md">
          {game.players.map(p => (
            <div key={p.id} className={`flex flex-wrap gap-1 max-w-[120px] ${p.id === 0 ? 'order-4' : p.id === 1 ? 'order-3' : p.id === 2 ? 'order-1' : 'order-2'}`}>
              {p.discards.map((t, i) => (
                <TileView key={`${p.id}-discard-${i}`} tile={t} small discarded />
              ))}
            </div>
          ))}
        </div>

        {/* Player Hands (Sides) */}
        
        {/* Top AI (Player 2) */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-1">
          {game.players[2].hand.map((_, i) => (
            <TileView key={`p2-hand-${i}`} hidden small />
          ))}
          {game.players[2].melds.map((m, i) => (
            <div key={`p2-meld-${i}`} className="flex gap-0.5 ml-2 bg-black/20 p-0.5 rounded">
              {m.tiles.map((t, ti) => <TileView key={`p2-meld-${i}-${ti}`} tile={t} small />)}
            </div>
          ))}
        </div>

        {/* Left AI (Player 3) */}
        <div className="absolute left-8 top-1/2 -translate-y-1/2 flex flex-col gap-1">
          {game.players[3].hand.map((_, i) => (
            <TileView key={`p3-hand-${i}`} hidden small vertical />
          ))}
          {game.players[3].melds.map((m, i) => (
            <div key={`p3-meld-${i}`} className="flex flex-col gap-0.5 mt-2 bg-black/20 p-0.5 rounded">
              {m.tiles.map((t, ti) => <TileView key={`p3-meld-${i}-${ti}`} tile={t} small vertical />)}
            </div>
          ))}
        </div>

        {/* Right AI (Player 1) */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-1">
          {game.players[1].hand.map((_, i) => (
            <TileView key={`p1-hand-${i}`} hidden small vertical />
          ))}
          {game.players[1].melds.map((m, i) => (
            <div key={`p1-meld-${i}`} className="flex flex-col gap-0.5 mt-2 bg-black/20 p-0.5 rounded">
              {m.tiles.map((t, ti) => <TileView key={`p1-meld-${i}-${ti}`} tile={t} small vertical />)}
            </div>
          ))}
        </div>

        {/* Center Indicators */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-48 h-48 rounded-full bg-black/20 flex flex-col items-center justify-center border-4 border-white/5 relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle,white_1px,transparent_1px)] bg-[length:10px_10px]" />
            <div className={`text-4xl font-bold transition-all duration-500 mb-2 ${game.currentTurn === 0 ? 'text-emerald-400 scale-110' : 'text-white/20'}`}>
              {WINDS[0]}
            </div>
            <div className="text-xs font-black text-yellow-500/80 tracking-[0.2em] uppercase text-center px-4 leading-relaxed">
              CK的亿万富豪之路
            </div>
          </div>
        </div>
      </div>

      {/* Player Area (Bottom) */}
      <div className="w-full max-w-6xl mt-8 flex flex-col items-center gap-4">
        
        {/* Action Buttons */}
        <AnimatePresence>
          {pendingActions.some(a => a.player === 0) && (
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="flex gap-4 mb-4"
            >
              {pendingActions.find(a => a.player === 0)?.actions.map(act => (
                <button
                  key={act}
                  onClick={() => performAction(0, act)}
                  className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl shadow-lg transform hover:scale-105 transition-all active:scale-95"
                >
                  {act}
                </button>
              ))}
              <button
                onClick={() => {
                  setPendingActions(prev => prev.filter(p => p.player !== 0));
                  if (pendingActions.length === 1) {
                    setTimeout(() => nextTurn((game.lastDiscard!.player + 1) % 4 as PlayerPosition), 500);
                  }
                }}
                className="px-8 py-3 bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-xl shadow-lg transform hover:scale-105 transition-all active:scale-95"
              >
                过
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Player Hand */}
        <div className="flex items-end gap-2 p-6 bg-black/20 backdrop-blur-xl rounded-[32px] border border-white/10 shadow-inner overflow-x-auto max-w-full">
          {/* Melds */}
          {player.melds.map((m, i) => (
            <div key={`p0-meld-${i}`} className="flex gap-1 mr-4 bg-white/5 p-1 rounded-xl">
              {m.tiles.map((t, ti) => <TileView key={`p0-meld-${i}-${ti}`} tile={t} small />)}
            </div>
          ))}
          
          {/* Hidden Hand */}
          <div className="flex gap-1.5">
            {player.hand.map((t, i) => (
              <TileView 
                key={t.id} 
                tile={t} 
                active={selectedTileId === t.id}
                onClick={() => {
                  if (game.phase !== 'Playing' || game.currentTurn !== 0) return;
                  if (selectedTileId === t.id) {
                    handleDiscard(0, t.id);
                    setSelectedTileId(null);
                  } else {
                    setSelectedTileId(t.id);
                  }
                }}
              />
            ))}
          </div>

          {/* Self-Draw Actions */}
          {game.phase === 'Playing' && game.currentTurn === 0 && canHu(player.hand, player.melds) && (
            <button
              onClick={() => setGame(prev => prev ? { ...prev, phase: 'GameOver', winner: 0, winType: 'SelfDraw', logs: ['你自摸胡牌了！', ...prev.logs] } : null)}
              className="ml-6 px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-black text-xl rounded-2xl shadow-xl animate-pulse"
            >
              胡
            </button>
          )}
        </div>
        
        <div className="text-white/40 text-xs mt-2 flex items-center gap-2">
          <Info size={14} />
          <span>点击选中，再次点击出牌。满足条件时会自动弹出操作按钮。</span>
        </div>
      </div>

      {/* Game Over Overlay */}
      <AnimatePresence>
        {game.phase === 'GameOver' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-8"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-emerald-950 border border-white/10 p-12 rounded-[48px] shadow-2xl text-center max-w-2xl w-full"
            >
              <div className="w-24 h-24 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-yellow-500/20">
                <Trophy size={48} className="text-black" />
              </div>
              <h2 className="text-5xl font-black mb-2">
                {game.winner !== null ? `${game.players[game.winner].name} 获胜！` : '流局'}
              </h2>
              <p className="text-white/60 text-xl mb-8">
                {game.winner !== null ? (game.winType === 'SelfDraw' ? '自摸胡牌' : '点炮胡牌') : '牌墙已空，无人胡牌'}
              </p>
              
              <div className="flex flex-col gap-4">
                <button 
                  onClick={initGame}
                  className="w-full py-5 bg-white text-black font-bold text-xl rounded-2xl hover:bg-gray-200 transition-all flex items-center justify-center gap-3"
                >
                  <RotateCcw size={24} />
                  再来一局
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logs Sidebar */}
      <AnimatePresence>
        {showLogs && (
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="fixed top-0 right-0 h-full w-80 bg-black/60 backdrop-blur-2xl border-l border-white/10 z-40 p-6 flex flex-col"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <History size={20} className="text-emerald-400" />
                对局日志
              </h3>
              <button onClick={() => setShowLogs(false)} className="p-2 hover:bg-white/10 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {game.logs.map((log, i) => (
                <div key={i} className="text-sm text-white/70 border-b border-white/5 pb-2 last:border-0">
                  {log}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Music */}
      <audio 
        ref={audioRef}
        loop
        src="https://api.p6p.net/api/m_song?id=1345848061" 
      />
      {/* 提示：由于浏览器安全限制，音乐需要您点击右上角的喇叭图标手动开启。
          如果链接失效，请检查网络或更换音乐源。 */}

    </div>
  );
}
