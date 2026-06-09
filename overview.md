# README 重写完成

## 做了什么

将 GLaDOS Workers Check-In 的 README.md 从特性列表式文档**完整重写**为手把手部署指南。

## 关键改动

| 改动 | 之前 | 之后 |
|------|------|------|
| 结构 | 特性列表优先，配置说明散落各处 | 八步部署流程，排障最后 |
| CF API Token | "建议使用权限最小化的 Cloudflare API Token" | 完整点击路径 + 三行权限矩阵 + 不要用模板的警告 |
| Cookie 获取 | 5 行简单说明 | 7 个子步骤，含 Network 面板筛选、请求头定位 |
| 密钥分离 | GitHub Secrets 和 Cloudflare Variables 混在一起 | 分别在第五步和第六步，明确标注 "仅用于 CI/CD" vs "运行时" |
| 验证 | 几乎没有 | 每步后都有 "应返回"/"应看到" 验证 |
| 排障 | 简单列表 | Q&A 格式，覆盖源码中所有 `throw new Error(...)` 场景 |
| 代码块 | 部分缺少语言标记 | 全部 12 个代码块带语言标记 |

## 方法论输出

创建了 `readme-from-scratch` SKILL（user-level），路径 `~/.workbuddy/skills/readme-from-scratch/`，包含：
- `SKILL.md`: 六阶段方法论（阅读代码→识别缺口→构建大纲→手把手写作→逐步验证→质量检查清单）
- `references/template.md`: 文档骨架模板
- `scripts/check_readme.py`: README 质量自动检查工具

## 提交信息

- Commit: `38ea481` → pushed to `main`
- 变更: 370 行新增, 345 行删除
