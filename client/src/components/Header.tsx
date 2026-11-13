export function Header() {
  return (
    <header className="chat-header">
      <div className="header-actions-left">
        <button className="icon-btn" id="openSidebarBtn" aria-label="فتح القائمة" title="القائمة الرئيسية">
          ☰
        </button>
      </div>

      <div className="header-center">
        <div className="header-brand">
          <h1>المستشار الرياضي</h1>
          <span className="header-subtitle">الذكاء الاصطناعي ومحرك الحلول الفوري</span>
        </div>
      </div>

      <div className="header-actions-right">
        <button
          className="icon-btn"
          id="headerNewChatBtn"
          aria-label="محادثة جديدة"
          title="محادثة جديدة"
        >
          ＋
        </button>
        <button className="icon-btn" id="darkModeToggle" aria-label="تبديل الوضع" title="تبديل المظهر">
          ☀️
        </button>
      </div>
    </header>
  )
}

