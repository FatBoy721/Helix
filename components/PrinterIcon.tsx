// Custom 4-toolhead whole-printer icon (Snapmaker U1).
//
// Translated from assets/icons/printer.svg. Callers may tint the enclosure for
// contrast while the darker window, gantry, toolheads, and plate retain the
// illustration's depth.
import React from 'react';
import { type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export function PrinterIcon({
  size,
  color,
  style,
}: {
  size: number;
  color?: string;
  style?: ViewStyle;
}) {
  return (
    <Svg viewBox="120 110 784 784" width={size} height={size} style={style}>
      <Defs>
        <LinearGradient
          id="bodyGrad"
          x1="160"
          y1="180"
          x2="878"
          y2="870"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={color ?? '#303030'} />
          <Stop offset="0.48" stopColor={color ?? '#1D1D1D'} stopOpacity={color ? 0.78 : 1} />
          <Stop offset="1" stopColor={color ?? '#2A2A2A'} stopOpacity={color ? 0.9 : 1} />
        </LinearGradient>
        <LinearGradient
          id="edgeGrad"
          x1="226"
          y1="424"
          x2="795"
          y2="766"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#141414" />
          <Stop offset="1" stopColor="#090909" />
        </LinearGradient>
        <LinearGradient
          id="metalGrad"
          x1="272"
          y1="459"
          x2="750"
          y2="487"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#292929" />
          <Stop offset="0.5" stopColor="#1F1F1F" />
          <Stop offset="1" stopColor="#303030" />
        </LinearGradient>
        <LinearGradient
          id="plateGrad"
          x1="245"
          y1="647"
          x2="777"
          y2="730"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#2B2B2B" />
          <Stop offset="1" stopColor="#191919" />
        </LinearGradient>
        <LinearGradient
          id="panelGrad"
          x1="677"
          y1="334"
          x2="808"
          y2="392"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#4B4B4B" />
          <Stop offset="1" stopColor="#333333" />
        </LinearGradient>
      </Defs>

      {/* Bowden tube / filament guide stubs */}
      <G fill="url(#bodyGrad)" stroke="#090909" strokeWidth={1}>
        <Path d="M433 217V137C433 136.45 433.45 136 434 136H449C449.55 136 450 136.45 450 137V217H433Z" />
        <Path d="M481 217V137C481 136.45 481.45 136 482 136H497C497.55 136 498 136.45 498 137V217H481Z" />
        <Path d="M526 217V137C526 136.45 526.45 136 527 136H542C542.55 136 543 136.45 543 137V217H526Z" />
        <Path d="M573 217V137C573 136.45 573.45 136 574 136H589C589.55 136 590 136.45 590 137V217H573Z" />
      </G>

      {/* Main printer enclosure */}
      <Path
        d="M250 217H774C802 217 827 234 837 260L869 345C870.3 348.4 871 352 871 355.7V799C871 829 847 853 817 853H814L810 864C808.4 868.4 804.2 871 799.6 871H708.4C703.8 871 699.6 868.4 698 864L694 853H329L325 864C323.4 868.4 319.2 871 314.6 871H223.4C218.8 871 214.6 868.4 213 864L209 853H207C177 853 153 829 153 799V355.7C153 352 153.7 348.4 155 345L187 260C197 234 222 217 250 217Z"
        fill="url(#bodyGrad)"
        stroke="#080808"
        strokeWidth={1.4}
      />

      {/* Control screen */}
      <Rect x={677} y={334} width={131} height={58} rx={6} fill="url(#panelGrad)" stroke="#1A1A1A" strokeWidth={1.2} />
      <Rect x={690} y={345} width={37} height={13} rx={6.5} fill="#171717" stroke="#080808" strokeWidth={1} />
      <Rect x={690} y={367} width={70} height={12} rx={6} fill="#171717" stroke="#080808" strokeWidth={1} />
      <Circle cx={783.5} cy={363} r={15} fill="#1A1A1A" stroke="#0A0A0A" strokeWidth={1.2} />

      {/* Door / viewing window */}
      <Rect x={226} y={424} width={569} height={342} rx={24} fill="url(#edgeGrad)" stroke="#060606" strokeWidth={1.5} />

      {/* X gantry rail */}
      <Rect x={272} y={459} width={479} height={28} rx={14} fill="url(#metalGrad)" stroke="#111" strokeWidth={1.1} />

      {/* Four toolheads */}
      <G fill="#242424" stroke="#101010" strokeWidth={1.1}>
        <Path d="M304 487H382V529C382 539 374 547 364 547H355L345 569C344.3 570.6 341.9 570.6 341.2 569L331 547H322C312 547 304 539 304 529V487Z" />
        <Path d="M416 487H494V529C494 539 486 547 476 547H467L457 569C456.3 570.6 453.9 570.6 453.2 569L443 547H434C424 547 416 539 416 529V487Z" />
        <Path d="M528 487H606V529C606 539 598 547 588 547H579L569 569C568.3 570.6 565.9 570.6 565.2 569L555 547H546C536 547 528 539 528 529V487Z" />
        <Path d="M640 487H718V529C718 539 710 547 700 547H691L681 569C680.3 570.6 677.9 570.6 677.2 569L667 547H658C648 547 640 539 640 529V487Z" />
      </G>

      {/* Build plate */}
      <Path
        d="M302 647H720C726 647 731 651 732 657L776 719C780 725 776 731 769 731H253C246 731 242 725 246 719L290 657C291 651 296 647 302 647Z"
        fill="url(#plateGrad)"
        stroke="#111"
        strokeWidth={1.2}
      />
    </Svg>
  );
}

export default PrinterIcon;
