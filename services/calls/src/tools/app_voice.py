from livekit.agents import RunContext, function_tool
from . import register


@register('navigate_app')
def navigate_app(agent):
    async def handler(context: RunContext, destination: str) -> dict:
        # The mobile RPC integration is not installed yet. Never pretend navigation succeeded.
        return {'ok': False, 'status': 'unavailable'}
    return function_tool(handler, name='navigate_app', description='Request navigation to an app screen.')
