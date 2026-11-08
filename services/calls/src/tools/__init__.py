"""Factories expose only the tools selected by this session's profile."""
TOOLS = {}


def register(name):
    def decorator(factory):
        if name in TOOLS:
            raise ValueError(f'Duplicate tool: {name}')
        TOOLS[name] = factory
        return factory
    return decorator


def build_tools(names, agent):
    return [TOOLS[name](agent) for name in names]


from . import common, app_voice, onboarding, phone_details  # noqa: E402,F401
