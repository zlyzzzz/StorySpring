# GitHub 上传与 Render 配置

## 两个文件的用途

- `StorySpring_GitHub_v7_轻量源码.zip`：解压后，把里面的文件和文件夹上传到 GitHub 仓库根目录。不要只上传 ZIP，不要把文件夹里的文件平铺到同一层。
- `storyspring-materials-v7.sqlite.gz`：数据库，上传到仓库的 Release 附件，不上传到 Code 文件列表。此文件有用，不能直接丢弃。

根目录应直接显示 server、tools、tests、package.json、index.html 等。
点号开头的 `.gitignore` 和 `.env.example` 也在源码包中。真实 `.env` 不上传。

## 上传数据库附件

1. 先提交解压后的轻量源码。
2. 仓库首页右侧选择 Releases，然后 Create a new release / Draft a new release。
3. 新建标签 `materials-v7`，填写标题 `StorySpring materials v7`。
4. 在附件区域上传 `storyspring-materials-v7.sqlite.gz`，然后发布 Release。
5. 在已发布 Release 中，对数据库附件右键复制链接地址。

如果仓库是 zlyzzzz/PlotSeed、标签是 materials-v7，链接形式如下：

`https://github.com/zlyzzzz/PlotSeed/releases/download/materials-v7/storyspring-materials-v7.sqlite.gz`

这是格式示例，必须先发布附件，链接才实际存在。目前没有替你上传或发布 Release。

## Render 设置

使用 Node Web Service，连接轻量源码所在的仓库。

- Root Directory：源码放在仓库根目录时留空。
- Build Command：`node tools/prepare_database.mjs`
- Start Command：`npm start`

环境变量：

| 名称 | 填写内容 |
| --- | --- |
| NODE_VERSION | 24.16.0 |
| HOST | 0.0.0.0 |
| MATERIALS_DOWNLOAD_URL | 复制的已发布数据库附件链接 |
| DEEPSEEK_API_KEY | 在 Render 私密填写自己的密钥 |
| DEEPSEEK_MODEL | deepseek-flash |

不要固定设置 PORT，使用 Render 提供的端口。当前项目没有 npm 依赖，不需要 npm ci 或 Vite 构建。
构建时脚本下载、解压数据库，并检查文件大小与 SHA-256；校验不通过会报错。
公开仓库的 Release 附件可直接下载。私有附件需要认证，本脚本未配置私有附件认证。
数据库随部署准备，不需要你的电脑保持开机。

## 不需要上传到 Code 的内容

- 完整的 server/data/materials.sqlite：使用单独的 Release 压缩附件。
- node_modules、dist、真实 .env、缓存。
- 原始语料压缩包、研究处理原始大数据库、以前的源码 ZIP。
- 截图、Excel 预览临时文件、.inspect.ndjson。

Python 处理脚本、测试、来源清单体积很小，保留有助于论文复现。
docx.mjs 是 Word 导出工具，caveat.woff2 是网站字体，都应保留。

## 仅在本机运行轻量包

先运行：

`node tools/prepare_database.mjs --archive 数据库压缩包的完整路径`

再把 .env.example 复制为 .env、填写自己的密钥，双击 Start-StorySpring.cmd。

参考：[GitHub 大文件限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)、[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)、[Render Node 部署](https://render.com/docs/deploy-node-express-app)。
