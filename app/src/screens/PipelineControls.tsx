import React from "react";
import { Pressable, Text, TextInput, View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { c } from "../theme";
export const money = (n: number) => "$" + (n / 100).toFixed(2);
export function Page({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: 120 }}
      >
        <Text
          accessibilityRole="header"
          style={{
            fontSize: 26,
            color: c.primary,
            fontFamily: "Manrope_700Bold",
          }}
        >
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 14,
        borderRadius: 12,
        backgroundColor: disabled ? c.outline : c.primary,
      }}
    >
      <Text style={{ color: "#fff", textAlign: "center", fontSize: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={{
          backgroundColor: "white",
          padding: 12,
          borderRadius: 10,
          fontSize: 16,
          color: c.primary,
        }}
      />
    </View>
  );
}
export function Box({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: 16,
        borderRadius: 16,
        backgroundColor: "white",
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}
