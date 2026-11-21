import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors } from '../ui/theme';
import type { RouteMapProps } from './RouteMap';

export type { RouteMapProps } from './RouteMap';

/**
 * Веб-версия: react-native-maps не загружается в браузере, поэтому рисуем
 * стилизованную демо-карту в палитре V1. Это именно превью для разработки,
 * а не реальные геоданные — на iOS/Android используется RouteMap.tsx.
 */
export function RouteMap({ style }: RouteMapProps): React.JSX.Element {
  return (
    <View style={[style ? null : styles.map, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 390 700" preserveAspectRatio="xMidYMid slice">
        <Rect x={0} y={0} width={390} height={700} fill="#F4F1EA" />

        {/* Кварталы */}
        <Rect x={18} y={96} width={92} height={86} rx={10} fill="#E8E1D4" />
        <Rect x={132} y={72} width={104} height={110} rx={12} fill="#E8E1D4" />
        <Rect x={258} y={64} width={104} height={104} rx={18} fill="#DDE6D8" />
        <Rect x={18} y={210} width={92} height={92} rx={10} fill="#E8E1D4" />
        <Rect x={132} y={210} width={104} height={92} rx={10} fill="#E8E1D4" />
        <Rect x={258} y={210} width={104} height={92} rx={10} fill="#E8E1D4" />
        <Rect x={18} y={330} width={92} height={104} rx={10} fill="#E8E1D4" />
        <Rect x={132} y={330} width={104} height={104} rx={10} fill="#E8E1D4" />
        <Rect x={258} y={330} width={104} height={104} rx={10} fill="#E8E1D4" />
        <Rect x={18} y={462} width={92} height={100} rx={10} fill="#E8E1D4" />
        <Rect x={132} y={462} width={104} height={100} rx={10} fill="#E8E1D4" />
        <Rect x={258} y={462} width={104} height={100} rx={10} fill="#E8E1D4" />

        {/* Река */}
        <Path
          d="M 356 0 C 330 120 372 240 340 360 S 306 520 350 700"
          stroke="#CFE0E6"
          strokeWidth={24}
          fill="none"
          strokeLinecap="round"
        />

        {/* Улицы */}
        <Path d="M 0 190 H 390" stroke="#FFFFFF" strokeWidth={12} />
        <Path d="M 0 312 H 390" stroke="#FFFFFF" strokeWidth={10} />
        <Path d="M 0 446 H 390" stroke="#FFFFFF" strokeWidth={12} />
        <Path d="M 0 574 H 390" stroke="#FFFFFF" strokeWidth={9} />
        <Path d="M 120 0 V 700" stroke="#FFFFFF" strokeWidth={12} />
        <Path d="M 246 0 V 700" stroke="#FFFFFF" strokeWidth={9} />
        <Path d="M 0 640 L 390 118" stroke="#FFFFFF" strokeWidth={18} />
        <Path d="M 0 520 L 390 260" stroke="#FFFFFF" strokeWidth={7} />

        {/* Парк */}
        <Circle cx={292} cy={102} r={5} fill="#B7C9AE" />
        <Circle cx={318} cy={124} r={4} fill="#B7C9AE" />
        <Circle cx={338} cy={96} r={6} fill="#B7C9AE" />

        {/* Маршрут */}
        <Path
          d="M 70 640 C 92 560 120 520 150 480 S 210 400 235 340 S 270 240 300 160"
          stroke="#FFFFFF"
          strokeWidth={13}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M 70 640 C 92 560 120 520 150 480 S 210 400 235 340 S 270 240 300 160"
          stroke={colors.accent}
          strokeWidth={6.5}
          fill="none"
          strokeLinecap="round"
        />

        {/* Точка «я» */}
        <Circle cx={70} cy={640} r={12} fill="#FFFFFF" />
        <Circle cx={70} cy={640} r={7.5} fill={colors.accent2} />

        {/* Цель */}
        <Circle cx={300} cy={160} r={13} fill="#FFFFFF" />
        <Circle cx={300} cy={160} r={9} fill={colors.ink} />
        <Circle cx={300} cy={160} r={3.5} fill="#FFFFFF" />

        <SvgText x={292} y={110} fill="#7C8C72" fontSize={10} fontWeight="600">
          Парк
        </SvgText>
        <SvgText
          x={196}
          y={688}
          fill={colors.soft}
          fontSize={9}
          letterSpacing={1.4}
          textAnchor="middle"
        >
          ДЕМО-КАРТА · WEB
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 220,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
});
