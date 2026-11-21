import type { ReactNode } from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { ManeuverIcon } from '@/nav/maneuverMap';

import { colors } from './theme';

export type IconName =
  | 'search'
  | 'mic'
  | 'map'
  | 'assistant'
  | 'glasses'
  | 'clock'
  | 'route'
  | 'arrowRight'
  | 'arrowLeft'
  | 'arrowUp'
  | 'arrowUpRight'
  | 'arrowUpLeft'
  | 'arrowDownLeft'
  | 'arrowDownRight'
  | 'chevronRight'
  | 'chevronLeft'
  | 'close'
  | 'send'
  | 'stop'
  | 'scan'
  | 'sliders'
  | 'check'
  | 'warning'
  | 'play'
  | 'flag'
  | 'uturn'
  | 'roundabout'
  | 'stairs'
  | 'ferry'
  | 'pin'
  | 'dot';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function iconShape(name: IconName, color: string, strokeWidth: number): ReactNode {
  const stroke = {
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={7} {...stroke} />
          <Line x1={16.5} y1={16.5} x2={21} y2={21} {...stroke} />
        </>
      );
    case 'mic':
      return (
        <>
          <Rect x={9} y={2.5} width={6} height={12} rx={3} {...stroke} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" {...stroke} />
          <Line x1={12} y1={17.5} x2={12} y2={21} {...stroke} />
          <Line x1={8.5} y1={21} x2={15.5} y2={21} {...stroke} />
        </>
      );
    case 'map':
      return (
        <>
          <Path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" {...stroke} />
          <Line x1={9} y1={4} x2={9} y2={18} {...stroke} />
          <Line x1={15} y1={6} x2={15} y2={20} {...stroke} />
        </>
      );
    case 'assistant':
      return (
        <>
          <Path d="M21 11.5a8 8 0 0 1-8 8H7.5L3 22v-5.4A8.5 8.5 0 1 1 21 11.5Z" {...stroke} />
          <Circle cx={8.5} cy={11.5} r={0.9} fill={color} />
          <Circle cx={12.5} cy={11.5} r={0.9} fill={color} />
          <Circle cx={16.5} cy={11.5} r={0.9} fill={color} />
        </>
      );
    case 'glasses':
      return (
        <>
          <Rect x={2.5} y={9} width={8} height={6} rx={3} {...stroke} />
          <Rect x={13.5} y={9} width={8} height={6} rx={3} {...stroke} />
          <Path d="M10.5 12h3" {...stroke} />
        </>
      );
    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Polyline points="12 7 12 12 15.5 14" {...stroke} />
        </>
      );
    case 'route':
      return (
        <>
          <Circle cx={5.5} cy={18.5} r={2.2} {...stroke} />
          <Circle cx={18.5} cy={5.5} r={2.2} {...stroke} />
          <Path d="M7.7 18.5h4.3a3 3 0 0 0 0-6H9.5a3 3 0 0 1 0-6h6.8" {...stroke} />
        </>
      );
    case 'arrowRight':
      return (
        <>
          <Line x1={4} y1={12} x2={20} y2={12} {...stroke} />
          <Polyline points="14 6 20 12 14 18" {...stroke} />
        </>
      );
    case 'arrowLeft':
      return (
        <>
          <Line x1={20} y1={12} x2={4} y2={12} {...stroke} />
          <Polyline points="10 6 4 12 10 18" {...stroke} />
        </>
      );
    case 'arrowUp':
      return (
        <>
          <Line x1={12} y1={20} x2={12} y2={4} {...stroke} />
          <Polyline points="6 10 12 4 18 10" {...stroke} />
        </>
      );
    case 'arrowUpRight':
      return (
        <>
          <Line x1={6} y1={18} x2={18} y2={6} {...stroke} />
          <Polyline points="9 6 18 6 18 15" {...stroke} />
        </>
      );
    case 'arrowUpLeft':
      return (
        <>
          <Line x1={18} y1={18} x2={6} y2={6} {...stroke} />
          <Polyline points="15 6 6 6 6 15" {...stroke} />
        </>
      );
    case 'arrowDownLeft':
      return (
        <>
          <Line x1={18} y1={6} x2={6} y2={18} {...stroke} />
          <Polyline points="6 9 6 18 15 18" {...stroke} />
        </>
      );
    case 'arrowDownRight':
      return (
        <>
          <Line x1={6} y1={6} x2={18} y2={18} {...stroke} />
          <Polyline points="18 9 18 18 9 18" {...stroke} />
        </>
      );
    case 'chevronRight':
      return <Polyline points="9 5 16 12 9 19" {...stroke} />;
    case 'chevronLeft':
      return <Polyline points="15 5 8 12 15 19" {...stroke} />;
    case 'close':
      return (
        <>
          <Line x1={6} y1={6} x2={18} y2={18} {...stroke} />
          <Line x1={18} y1={6} x2={6} y2={18} {...stroke} />
        </>
      );
    case 'send':
      return (
        <>
          <Path d="M22 2 11 13" {...stroke} />
          <Path d="M22 2 15 22l-4-9-9-4 20-7Z" {...stroke} />
        </>
      );
    case 'stop':
      return <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={color} />;
    case 'scan':
      return (
        <>
          <Path d="M4 8V5a1 1 0 0 1 1-1h3" {...stroke} />
          <Path d="M16 4h3a1 1 0 0 1 1 1v3" {...stroke} />
          <Path d="M20 16v3a1 1 0 0 1-1 1h-3" {...stroke} />
          <Path d="M8 20H5a1 1 0 0 1-1-1v-3" {...stroke} />
          <Line x1={7} y1={12} x2={17} y2={12} {...stroke} />
        </>
      );
    case 'sliders':
      return (
        <>
          <Line x1={4} y1={7} x2={20} y2={7} {...stroke} />
          <Circle cx={9} cy={7} r={2.2} {...stroke} fill={colors.surface} />
          <Line x1={4} y1={12} x2={20} y2={12} {...stroke} />
          <Circle cx={15} cy={12} r={2.2} {...stroke} fill={colors.surface} />
          <Line x1={4} y1={17} x2={20} y2={17} {...stroke} />
          <Circle cx={7} cy={17} r={2.2} {...stroke} fill={colors.surface} />
        </>
      );
    case 'check':
      return <Polyline points="5 12.5 9.5 17 19 6.5" {...stroke} />;
    case 'warning':
      return (
        <>
          <Path d="M12 3 22 21H2L12 3Z" {...stroke} />
          <Line x1={12} y1={9} x2={12} y2={14} {...stroke} />
          <Circle cx={12} cy={17.5} r={1} fill={color} />
        </>
      );
    case 'play':
      return <Path d="M8 5.5 19 12 8 18.5Z" fill={color} />;
    case 'flag':
      return (
        <>
          <Line x1={5} y1={21} x2={5} y2={3.5} {...stroke} />
          <Path d="M5 4h11l-2 4 2 4H5" {...stroke} />
        </>
      );
    case 'uturn':
      return (
        <>
          <Path d="M7 20V9a5 5 0 0 1 10 0v5" {...stroke} />
          <Polyline points="13.5 11.5 17 15 20.5 11.5" {...stroke} />
        </>
      );
    case 'roundabout':
      return (
        <>
          <Circle cx={12} cy={12} r={7} {...stroke} />
          <Polyline points="12 5 15 8 12 11" {...stroke} />
          <Polyline points="12 19 9 16 12 13" {...stroke} />
        </>
      );
    case 'stairs':
      return <Path d="M3 21h4v-4h4v-4h4V9h4V5h2" {...stroke} />;
    case 'ferry':
      return (
        <>
          <Path d="M4 14h16l-2 6H6l-2-6Z" {...stroke} />
          <Path d="M7 14V8h10v6" {...stroke} />
          <Line x1={12} y1={4} x2={12} y2={8} {...stroke} />
        </>
      );
    case 'pin':
      return (
        <>
          <Path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" {...stroke} />
          <Circle cx={12} cy={9} r={2.5} {...stroke} />
        </>
      );
    case 'dot':
      return <Circle cx={12} cy={12} r={4.5} fill={color} />;
    default:
      return <Circle cx={12} cy={12} r={4.5} fill={color} />;
  }
}

export function Icon({ name, size = 22, color = colors.ink, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {iconShape(name, color, strokeWidth)}
    </Svg>
  );
}

export function maneuverIconName(type: number): IconName {
  switch (type) {
    case ManeuverIcon.STRAIGHT:
      return 'arrowUp';
    case ManeuverIcon.SLIGHT_RIGHT:
      return 'arrowUpRight';
    case ManeuverIcon.RIGHT:
      return 'arrowRight';
    case ManeuverIcon.SHARP_RIGHT:
      return 'arrowDownRight';
    case ManeuverIcon.UTURN:
      return 'uturn';
    case ManeuverIcon.SHARP_LEFT:
      return 'arrowDownLeft';
    case ManeuverIcon.LEFT:
      return 'arrowLeft';
    case ManeuverIcon.SLIGHT_LEFT:
      return 'arrowUpLeft';
    case ManeuverIcon.ROUNDABOUT:
      return 'roundabout';
    case ManeuverIcon.ARRIVE:
      return 'flag';
    case ManeuverIcon.START:
      return 'play';
    case ManeuverIcon.STAIRS_OR_CROSSING:
      return 'stairs';
    case ManeuverIcon.KEEP_RIGHT:
      return 'arrowUpRight';
    case ManeuverIcon.KEEP_LEFT:
      return 'arrowUpLeft';
    case ManeuverIcon.FERRY_OR_TRANSIT:
      return 'ferry';
    default:
      return 'dot';
  }
}
