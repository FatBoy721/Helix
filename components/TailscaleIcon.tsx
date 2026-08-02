import React from 'react';
import Svg, { Circle } from 'react-native-svg';

type Props = { size?: number; color?: string };

/** Official Tailscale dot-grid mark, kept inline so it stays crisp and works offline. */
export default function TailscaleIcon({ size = 20, color = '#FFFFFF' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" accessibilityLabel="Tailscale">
      <Circle cx="3" cy="3" r="2" fill={color} opacity={0.38} />
      <Circle cx="9" cy="3" r="2" fill={color} opacity={0.38} />
      <Circle cx="15" cy="3" r="2" fill={color} opacity={0.38} />
      <Circle cx="3" cy="9" r="2" fill={color} />
      <Circle cx="9" cy="9" r="2" fill={color} />
      <Circle cx="15" cy="9" r="2" fill={color} />
      <Circle cx="3" cy="15" r="2" fill={color} opacity={0.38} />
      <Circle cx="9" cy="15" r="2" fill={color} />
      <Circle cx="15" cy="15" r="2" fill={color} opacity={0.38} />
    </Svg>
  );
}
