/**
 * dsh-table-lens —— 宿主侧空壳插件。
 *
 * 这个插件没有任何宿主能力（不注册工具、不开接口、不读写文件）：
 * 全部逻辑都在 client.js 里，由 DSH Web 前端加载后直接增强页面上的表格。
 * 这里保留一个合法的 apply，只是为了让 bundle 在配置树里有一行、能被启用/停用。
 */
export function apply() {
  /* 无需宿主侧初始化 */
}
