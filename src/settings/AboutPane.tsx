export default function AboutPane() {
  return (
    <div className="flex flex-col items-center justify-center py-8 space-y-3">
      <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-2xl font-bold">
        G
      </div>
      <h2 className="text-lg font-semibold">GLM Quota Monitor</h2>
      <p className="text-xs text-neutral-500">v0.1.0</p>
      <p className="text-xs text-neutral-600 text-center max-w-xs">
        智谱 GLM Coding Plan 额度监控工具
      </p>
      <a
        href="https://github.com/Ngaizean/glm-quota-monitor"
        target="_blank"
        className="text-xs text-blue-400 hover:text-blue-300 mt-2"
      >
        GitHub
      </a>
    </div>
  );
}
