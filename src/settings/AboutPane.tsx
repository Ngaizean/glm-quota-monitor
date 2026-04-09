export default function AboutPane() {
  return (
    <div className="flex flex-col items-center justify-center py-4 space-y-2">
      <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white text-sm font-bold">
        G
      </div>
      <h2 className="text-xs font-semibold text-gray-700">GLM Quota Monitor</h2>
      <p className="text-[10px] text-gray-400">v0.1.2</p>
      <p className="text-[10px] text-gray-400 text-center">
        智谱 GLM Coding Plan 额度监控
      </p>
      <a href="https://github.com/Ngaizean/glm-quota-monitor" target="_blank"
        className="text-[10px] text-blue-500 hover:text-blue-600 mt-1">GitHub</a>
    </div>
  );
}
