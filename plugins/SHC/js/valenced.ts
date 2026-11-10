import { lookupModule, getModules } from "@valenced/modules/finders";
import {
  withProps,
  createFilterGenerator,
  FilterScopes,
} from "@valenced/modules/finders/filters";
import { instead as nativeInstead } from "@valenced/patcher";
import { Stores } from "@valenced/discord/flux";
import { Design } from "@valenced/discord/design";
import {
  ActionSheetActionCreators,
  ToastActionCreators,
} from "@valenced/discord/actions";
import { getAssetIdByName } from "@valenced/assets";
type Fn = (...args: any[]) => any;
type Module = Record<string, any>;
const cache = new Map<string, Module>();
let sequence = 0;
export const findAssetId = getAssetIdByName;
export const findByStoreName = (name: string) =>
  (Stores as unknown as Module)[name];
export function showToast(text: string) {
  ToastActionCreators.open(`dariuss.show-hidden-channels.${++sequence}`, {
    text,
  });
}
export function findByProps(...props: string[]): Module | undefined {
  if (props.includes("openLazy")) return ActionSheetActionCreators;
  if (props.includes("ActionSheet")) return Design;
  const key = props.join("|");
  if (cache.has(key)) return cache.get(key);
  const [value] = lookupModule(withProps(...(props as [string, ...string[]])));
  if (value) cache.set(key, value as Module);
  return value as Module | undefined;
}
export const patcher = {
  instead(
    key: string,
    target: Module,
    hook: (args: any[], original: Fn) => any,
  ) {
    return nativeInstead(
      target as Record<string, Fn>,
      key,
      function (args, original) {
        return hook(args, (...next) => Reflect.apply(original, this, next));
      },
    );
  },
  after(key: string, target: Module, hook: (args: any[], result: any) => any) {
    return nativeInstead(
      target as Record<string, Fn>,
      key,
      function (args, original) {
        const result = Reflect.apply(original, this, args);
        return hook(args, result) ?? result;
      },
    );
  },
};
export function observeProps(
  props: [string, ...string[]],
  callback: (module: Module) => void,
) {
  let active = true;
  const remove = getModules(withProps(...props), (value) => {
    if (active) callback(value as Module);
  });
  return () => {
    active = false;
    remove();
  };
}
const componentFilter = createFilterGenerator<[string]>(
  ([name], _, value: any) => {
    const candidates = [
      value?.default,
      value?.default?.type,
      value?.type,
      value?.render,
      value,
    ];
    return candidates.some(
      (v) => v && (v.name === name || v.displayName === name),
    );
  },
  ([name]) => `dariuss.shc.component(${name})`,
  FilterScopes.Initialized,
);
export function observeComponent(
  name: string,
  wrap: (props: any, result: any) => any,
) {
  const patches: (() => void)[] = [],
    seen = new WeakSet<object>();
  let active = true;
  const remove = getModules(
    componentFilter(name),
    (value) => {
      if (!active) return;
      const mod = value as Module;
      let target = mod,
        key = "default";
      if (typeof mod.default?.type === "function") {
        target = mod.default;
        key = "type";
      } else if (typeof mod.default !== "function") {
        if (typeof mod.type === "function") key = "type";
        else if (typeof mod.render === "function") key = "render";
        else return;
      }
      if (seen.has(target)) return;
      seen.add(target);
      patches.push(
        patcher.after(key, target, (args, result) => wrap(args[0], result)),
      );
    },
    { returnNamespace: true },
  );
  return () => {
    active = false;
    remove();
    for (const unpatch of patches.splice(0).reverse()) unpatch();
  };
}
export function openChannel(channelId: string) {
  const channel = findByStoreName("ChannelStore")?.getChannel(channelId);
  if (!channel) throw new Error("Channel unavailable");
  const router = findByProps("transitionToGuild", "transitionTo");
  if (typeof router?.transitionToGuild !== "function")
    throw new Error("Channel navigation unavailable");
  router.transitionToGuild(channel.guild_id || "@me", channelId, undefined, {
    openChannel: true,
  });
}
export function clearCache() {
  cache.clear();
}
