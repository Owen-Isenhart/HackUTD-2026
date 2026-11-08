from src.agent import DEFAULT_TTS_VOICE, tts_voice


def test_default_voice_is_mia_in_us_english(monkeypatch):
    monkeypatch.delenv("TTS_VOICE", raising=False)
    assert DEFAULT_TTS_VOICE == "Magpie-Multilingual.EN-US.Mia"
    assert tts_voice() == "Magpie-Multilingual.EN-US.Mia"


def test_voice_can_be_overridden_from_the_environment(monkeypatch):
    monkeypatch.setenv("TTS_VOICE", "Magpie-Multilingual.EN-US.Leo")
    assert tts_voice() == "Magpie-Multilingual.EN-US.Leo"


def test_blank_override_falls_back_to_mia(monkeypatch):
    monkeypatch.setenv("TTS_VOICE", "   ")
    assert tts_voice() == DEFAULT_TTS_VOICE
