import { TextStyle } from 'react-native';

// Tokens from frontend-design/.../serene_waters_banking_system/DESIGN.md
export const c = {
  surface: '#fdf9f1',
  surfaceLowest: '#ffffff',
  surfaceLow: '#f7f3eb',
  surfaceContainer: '#f1ede5',
  surfaceHigh: '#ece8e0',
  surfaceHighest: '#e6e2da',
  surfaceDim: '#dddad2',
  onSurface: '#1c1c17',
  onSurfaceVariant: '#42484a',
  outline: '#73787a',
  outlineVariant: '#c2c7ca',
  primary: '#041920',
  onPrimary: '#ffffff',
  primaryContainer: '#1a2e35',
  onPrimaryContainer: '#81969e',
  primaryFixed: '#d0e6ef',
  primaryFixedDim: '#b4cad3',
  onPrimaryFixedVariant: '#364a51',
  secondary: '#206774',
  onSecondary: '#ffffff',
  secondaryContainer: '#a9eaf9',
  onSecondaryContainer: '#256b78',
  secondaryFixed: '#acedfc',
  secondaryFixedDim: '#90d1df',
  onSecondaryFixedVariant: '#004e5a',
  tertiaryContainer: '#003221',
  onTertiaryContainer: '#629e82',
  tertiaryFixed: '#b1f0d0',
  tertiaryFixedDim: '#95d4b5',
  onTertiaryFixed: '#002115',
  onTertiaryFixedVariant: '#0d513a',
  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  nav: '#07171e',
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { sm: 4, md: 8, lg: 12, xl: 16, xxl: 20, full: 9999 };

export const font = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semi: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
};

const base = { color: c.onSurface } as const;
export const type = {
  displayMobile: { ...base, fontFamily: font.semi, fontSize: 36, lineHeight: 44, letterSpacing: -0.9 },
  headlineLgMobile: { ...base, fontFamily: font.semi, fontSize: 26, lineHeight: 34, letterSpacing: -0.4 },
  headlineMd: { ...base, fontFamily: font.semi, fontSize: 22, lineHeight: 30, letterSpacing: -0.2 },
  headlineSm: { ...base, fontFamily: font.semi, fontSize: 18, lineHeight: 24, letterSpacing: -0.1 },
  bodyLg: { ...base, fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  bodyMd: { ...base, fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  bodySm: { ...base, fontFamily: font.regular, fontSize: 12, lineHeight: 18 },
  labelLg: { ...base, fontFamily: font.semi, fontSize: 14, lineHeight: 20, letterSpacing: 0.14 },
  labelMd: { ...base, fontFamily: font.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.24 },
  labelSm: { ...base, fontFamily: font.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.33 },
  mono: { ...base, fontFamily: font.semi, fontSize: 15, lineHeight: 20, letterSpacing: -0.15 },
} satisfies Record<string, TextStyle>;

export const tnum: TextStyle = { fontVariant: ['tabular-nums'] };

// DESIGN.md Level 2 card shadow
export const shadow = {
  card: {
    shadowColor: '#1a2e35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  sm: {
    shadowColor: '#1a2e35',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
} as const;
