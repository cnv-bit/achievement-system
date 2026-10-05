# 内容入口

`catalog.json` 与 `layouts.json` 是独立通用技术样例，包含七模块最小演示数据，不是生产角色树。

目录通过 `index.ts` 统一校验。正式内容优先由宿主注入 `GOBLIN_ACHIEVEMENTS_CATALOG`、`GOBLIN_ACHIEVEMENTS_LAYOUTS` 和 `GOBLIN_ACHIEVEMENTS_IMAGES`。字段表见 `docs/contracts/README.md`。

`images.ts` 是显式可选静态内置图片表，当前为空。角色私有图片不能提交；`images/` 下的内容文件默认被 Git 忽略。通用可复用边框放在 `src/frontend/assets/`。
