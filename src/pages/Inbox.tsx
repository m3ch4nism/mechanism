import EmailList from "../components/EmailList";
import EmailView from "../components/EmailView";

export default function Inbox() {
  return (
    <div className="inbox-layout">
      <EmailList />
      <EmailView />
    </div>
  );
}
