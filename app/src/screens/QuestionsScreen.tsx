import React, { useEffect, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { api } from "../finance/financeApi";
import { Page, Action, Field, Box } from "./PipelineControls";
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Stop = {
  brand: string;
  purpose: string;
  days: string[];
  start: string;
  end: string;
  quote: string;
  needsTime?: boolean;
};
export default function QuestionsScreen({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]),
    [start, setStart] = useState("09:00"),
    [end, setEnd] = useState("17:00"),
    [text, setText] = useState(""),
    [stops, setStops] = useState<Stop[]>([]),
    [unknown, setUnknown] = useState<string[]>([]),
    [error, setError] = useState(""),
    [versions, setVersions] = useState<Record<string, number>>({});
  useEffect(() => {
    void api("/api/v1/onboarding/answers")
      .then((r) => {
        const v: Record<string, number> = {};
        for (const a of r.answers) v[a.key] = a.version;
        setVersions(v);
        const work = r.answers.find(
          (a: { key: string }) => a.key === "work_schedule",
        )?.value;
        if (work && !work.skipped) {
          setWorkDays(work.days);
          setStart(work.start);
          setEnd(work.end);
        }
        const saved = r.answers.find(
          (a: { key: string }) => a.key === "regular_stops",
        )?.value;
        if (Array.isArray(saved))
          setStops(
            saved.map((s) => ({
              ...s,
              days: s.days.map(
                (d: number) =>
                  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][d - 1],
              ),
            })),
          );
      })
      .catch(() => {});
  }, []);
  const save = async (key: string, value: unknown, skipped = false) => {
    try {
      const r = await api("/api/v1/onboarding/answers", "PUT", {
        key,
        value,
        skipped,
        version: versions[key] || 0,
        confirmed: true,
      });
      setVersions((v) => ({ ...v, [key]: r.version }));
      setError("Saved");
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  return (
    <Page title="Your routine">
      <Text>Work hours come from you. Both questions are optional.</Text>
      <Box>
        <Text>Work days</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {days.map((d, i) => (
            <Pressable
              key={d}
              onPress={() =>
                setWorkDays((v) =>
                  v.includes(i + 1)
                    ? v.filter((n) => n !== i + 1)
                    : [...v, i + 1],
                )
              }
            >
              <Text>
                {workDays.includes(i + 1) ? "✓ " : ""}
                {d}
              </Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="Start (24-hour HH:MM)"
          value={start}
          onChangeText={setStart}
        />
        <Field label="End (24-hour HH:MM)" value={end} onChangeText={setEnd} />
        <Action
          label="Save work hours"
          onPress={() => {
            void save("work_schedule", { days: workDays, start, end });
          }}
        />
      </Box>
      <Box>
        <Field
          label="Regular stops, in your words"
          value={text}
          onChangeText={setText}
        />
        <Action
          label="Check my stops"
          onPress={() => {
            void api("/api/v1/onboarding/stops/check", "POST", { text })
              .then((r) => {
                setStops(r.accepted);
                setUnknown(r.notUnderstood);
              })
              .catch((e) => setError(String(e)));
          }}
        />
      </Box>
      {stops.map((s, i) => (
        <Box key={i}>
          <Text>
            {s.brand} · {s.purpose} · {s.days.join(", ")}
          </Text>
          <Text>“{s.quote}”</Text>
          <Field
            label="Start (HH:MM)"
            value={s.start}
            onChangeText={(v) =>
              setStops((a) =>
                a.map((e, j) => (i === j ? { ...e, start: v } : e)),
              )
            }
          />
          <Field
            label="End (HH:MM)"
            value={s.end}
            onChangeText={(v) =>
              setStops((a) => a.map((e, j) => (i === j ? { ...e, end: v } : e)))
            }
          />
          <Action
            label="Remove this stop"
            onPress={() => setStops((a) => a.filter((_, j) => j !== i))}
          />
        </Box>
      ))}
      {unknown.map((s, i) => (
        <Text key={i}>Not understood: {s}. You can skip this question.</Text>
      ))}
      {stops.length ? (
        <Action
          label="Confirm these stops"
          onPress={() => {
            void save(
              "regular_stops",
              stops.map((s) => ({
                ...s,
                days: s.days.map(
                  (d) =>
                    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(
                      d,
                    ) + 1,
                ),
              })),
            );
          }}
        />
      ) : null}
      <Text accessibilityLiveRegion="polite">{error}</Text>
      <Action
        label="Continue (skip unanswered questions)"
        onPress={() => {
          void (async () => {
            if (
              !versions.work_schedule &&
              !(await save("work_schedule", {}, true))
            )
              return;
            if (
              !versions.regular_stops &&
              !(await save("regular_stops", [], true))
            )
              return;
            onContinue();
          })();
        }}
      />
    </Page>
  );
}
