import useEventLogStore, { AppEvent } from "@Cypher/stores/eventLogStore";

export const useEvents = (): AppEvent[] =>
    useEventLogStore((s) => s.events);

export default useEvents;
