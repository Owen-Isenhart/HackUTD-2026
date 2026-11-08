from livekit.agents import RunContext, function_tool
from . import register


@register('respond_to_caller')
def respond_to_caller(agent):
    async def handler(context: RunContext, caller_words: str) -> dict:
        return await agent.respond_to_caller(context, caller_words)
    return function_tool(handler, name='respond_to_caller', description="Send the caller's exact words for account lookup or recommendations. Stay silent while awaiting the result.")


@register('record_decision')
def record_decision(agent):
    async def handler(context: RunContext, accepted: bool) -> dict:
        return await agent.record_decision(context, accepted)
    return function_tool(handler, name='record_decision', description='Record whether verification or the recommendation was accepted. Phone profiles say goodbye and end the call.')


@register('save_call_note')
def save_call_note(agent):
    async def handler(context: RunContext, note: str) -> dict:
        return await agent.save_call_note(context, note)
    return function_tool(handler, name='save_call_note', description='Save a non-sensitive note only when explicitly requested.')


@register('check_connection')
def check_connection(agent):
    async def handler(context: RunContext) -> dict:
        return await agent.check_connection(context)
    return function_tool(handler, name='check_connection', description='Check service connectivity.')
