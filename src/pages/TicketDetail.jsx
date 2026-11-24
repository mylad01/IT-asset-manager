// src/pages/TicketDetail.jsx // File path definition
import React, { useState, useEffect, useTransition } from 'react'; // Import core React hooks including useTransition
import { useParams, useNavigate } from 'react-router-dom'; // Import router hooks for navigation and URL parsing
import apiClient from '../utils/apiClient.js'; // Import your custom centralized API fetcher
import TicketExport from '../components/TicketExport.jsx'; // Import the PDF layout component we built earlier

export default function TicketDetail() { // Define and export the main page component
  const { id } = useParams(); // Extract the ticket ID from the browser URL
  const navigate = useNavigate(); // Initialize navigation helper for the back button
  const [ticket, setTicket] = useState(null); // State to store the fetched ticket data
  const [activityLogs, setActivityLogs] = useState([]); // State to store the fetched audit trail
  const [loading, setLoading] = useState(true); // State to handle initial UI loading spinner
  const [isPending, startTransition] = useTransition(); // React 19 hook to defer heavy rendering of complex JSON diffs

  useEffect(() => { // Hook to run when the component mounts or ID changes
    loadTicketData(); // Invoke the async data fetcher
  }, [id]); // Re-run if the URL ID changes

  const loadTicketData = async () => { // Async function to gather all required view data
    setLoading(true); // Ensure loading state is active
    try { // Begin protected API block
      const [ticketRes, logRes] = await Promise.all([ // Fire both GET requests simultaneously
        apiClient.get(`/api/tickets/${id}`), // Request core ticket data
        apiClient.get(`/api/tickets/${id}/activity`) // Request property diff audit logs
      ]); // Wait for both responses

      startTransition(() => { // Use React 19 transition to let the browser breathe while parsing/rendering heavy arrays
        if (ticketRes.ok) setTicket(ticketRes.data); // If successful, store ticket
        if (logRes.ok) setActivityLogs(logRes.data); // If successful, store logs
      }); // End transition wrapper
    } catch (err) { // Catch network or parse errors
      console.error('Failed to load ticket details:', err); // Log the error for debugging
    } finally { // Always execute this block
      setLoading(false); // Remove loading spinner regardless of success/fail
    } // End try-catch-finally
  }; // End loadTicketData function

  if (loading) { // Conditional render for loading state
    return <div className="p-6 text-white text-center">Loading ticket diagnostics...</div>; // Render simple loading text
  } // End loading check

  if (!ticket) { // Conditional render for missing data
    return <div className="p-6 text-[color:var(--status-danger)] text-center">Ticket not found or access denied.</div>; // Render error state
  } // End missing data check

  return ( // Render main valid state
    <div className="p-6 max-w-5xl mx-auto text-white space-y-6 relative"> {/* Container with max width and spacing */}
      
      <div className="flex justify-between items-center mb-4"> {/* Top utility row */}
        <button onClick={() => navigate(-1)} className="print:hidden text-[color:var(--ui-neutral)] hover:text-white transition-colors flex items-center gap-2"> {/* Back button (hidden during PDF print) */}
          <span>&larr;</span> Back to Tickets {/* Button label */}
        </button> {/* End back button */}
        {isPending && <span className="print:hidden text-xs text-[color:var(--status-info)] animate-pulse font-normal bg-[color:var(--status-info)]/10 px-2 py-1 rounded-full">Processing logs...</span>} {/* Background parsing indicator */}
      </div> {/* End top utility row */}

      <div className={`bg-[#181825] border border-[color:var(--ui-neutral-darkest)] rounded-2xl overflow-hidden print:bg-transparent print:border-none print:shadow-none transition-opacity duration-300 ${isPending ? 'opacity-70' : 'opacity-100'}`}> {/* Main card wrapper, slightly faded if a transition is active */}
        
        {/* Render our dedicated Export component, passing down the fetched data */} {/* Explanatory comment */}
        <TicketExport ticket={ticket} activityLogs={activityLogs} /> {/* Mount the TicketExport UI for the printable area */}
        
      </div> {/* End main card wrapper */}

      <div className="print:hidden flex justify-end gap-4"> {/* Action bar at the bottom, hidden during print */}
        <button onClick={() => alert('Update modal hook here')} className="bg-[color:var(--ui-neutral-darker)] hover:bg-[color:var(--ui-neutral-deep)] px-4 py-2 rounded-xl text-sm font-semibold transition-colors"> {/* Placeholder update button */}
          Edit Ticket {/* Button text */}
        </button> {/* End edit button */}
        <button onClick={() => navigate('/conversations')} className="bg-[color:var(--status-info-deep)] hover:bg-[color:var(--status-info-strong)] px-4 py-2 rounded-xl text-sm font-semibold transition-colors"> {/* Button jumping to discussions */}
          Go to Discussions {/* Button text */}
        </button> {/* End discussions button */}
      </div> {/* End action bar */}

    </div> // End main container
  ); // End return
} // End component